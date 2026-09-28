import {
  addPublicClaimSuspicion,
  chooseStrategicNightTarget,
  findNpcInsight,
  MADMAN_WHITE_CLAIM_CHANCE,
  npcDecisionSuspicion,
  npcSeerClaimPlanStartsOnDay,
  personalityForSerial,
  planNpcSeerClaims,
} from "./npc";
import { resolveVoteOutcome, topVotedIds } from "./presentation";
import { buildRoles, getWinner, roleConfigFromRoles } from "./roles";
import {
  assignGameRoles,
  buildSoloRoles,
  chooseNpcRevoteTarget,
  chooseNpcVoteTarget,
} from "./solo";
import type {
  HumanArgument,
  Player,
  PublicResult,
  RoleClaim,
  RoleName,
  VoteRecord,
  Winner,
} from "./types";

export interface PlaytestScenario {
  name: string;
  profile:
    | "ソロ標準"
    | "通常配役"
    | "狂人入り"
    | "複数占い"
    | "複数狂人"
    | "複数騎士"
    | "自由配役";
  roles: RoleName[];
  humanCount: number;
}

export interface SimulationResult {
  winner: Winner;
  days: number;
  humanAlive: boolean;
  humanRole: RoleName;
  timedOut: boolean;
  loneBlackSituations: number;
  loneBlackExecutions: number;
  loneBlackVotes: number;
  loneBlackBallots: number;
  loneFalseBlackSituations: number;
  loneFalseBlackExecutions: number;
  contestedBlackSituations: number;
  contestedBlackVotes: number;
  contestedBlackBallots: number;
  dayOneExecutions: number;
  dayOneExecutionsWithoutBlackClaim: number;
  ownClaimBallots: number;
  ownClaimContradictions: number;
  discussionBallots: number;
  discussionVoteMatches: number;
  roleAlive: Map<RoleName, number>;
  roleAssigned: Map<RoleName, number>;
}

export interface ScenarioSummary {
  scenario: PlaytestScenario;
  trials: number;
  villageWinRate: number;
  averageDays: number;
  humanSurvivalRate: number;
  timeoutRate: number;
  loneBlackExecutionRate: number | null;
  loneBlackVoteRate: number | null;
  loneFalseBlackExecutionRate: number | null;
  contestedBlackVoteRate: number | null;
  dayOneNoBlackClaimExecutionRate: number | null;
  ownClaimContradictionRate: number | null;
  discussionVoteMatchRate: number | null;
  roleSurvivalRates: Map<RoleName, number>;
}

interface SimulationState {
  day: number;
  players: Player[];
  roleConfig: ReturnType<typeof roleConfigFromRoles>;
  npcSuspicion: Map<string, number>;
  npcMemory: Map<string, Map<string, number>>;
  npcClaims: RoleClaim[];
  npcSeerClaimPlans: ReturnType<typeof planNpcSeerClaims>;
  humanSuspicions: Map<string, HumanArgument>;
  voteHistory: VoteRecord[];
  executionHistory: Player[];
}

interface SeerResult {
  targetId: string;
  isWolf: boolean;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomItem<T>(values: T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function remember(
  state: SimulationState,
  observerId: string,
  targetId: string,
  amount: number,
): void {
  const memory = state.npcMemory.get(observerId) ?? new Map<string, number>();
  memory.set(targetId, (memory.get(targetId) ?? 0) + amount);
  state.npcMemory.set(observerId, memory);
}

function recordResultClaim(
  state: SimulationState,
  day: number,
  speaker: Player,
  claimedRole: "占い師" | "霊能者",
  target: Player,
  result: PublicResult,
  resultDay?: number,
): void {
  const duplicate = state.npcClaims.some(
    (claim) =>
      claim.day === day &&
      claim.speakerId === speaker.id &&
      claim.claimedRole === claimedRole &&
      claim.targetId === target.id,
  );
  if (duplicate) return;
  state.npcClaims.push({
    day,
    resultDay,
    speakerId: speaker.id,
    claimedRole,
    targetId: target.id,
    result,
  });
  if (claimedRole === "占い師")
    addPublicClaimSuspicion(state.npcSuspicion, target.id, result);
}

function latestResultsByTarget(
  claims: RoleClaim[],
  speakerId: string,
): Map<string, PublicResult> {
  const results = new Map<string, PublicResult>();
  for (const claim of claims) {
    if (claim.claimedRole === "占い師" && claim.speakerId === speakerId) {
      results.set(claim.targetId, claim.result);
    }
  }
  return results;
}

function seerClaimants(claims: RoleClaim[]): Set<string> {
  return new Set(
    claims
      .filter((claim) => claim.claimedRole === "占い師")
      .map((claim) => claim.speakerId),
  );
}

function claimedRoleFor(
  claims: RoleClaim[],
  playerId: string,
): "占い師" | "霊能者" | undefined {
  return claims.find((claim) => claim.speakerId === playerId)?.claimedRole;
}

function addSeerResult(
  results: Map<string, SeerResult[]>,
  seer: Player,
  target: Player,
): void {
  const known = results.get(seer.id) ?? [];
  if (!known.some((result) => result.targetId === target.id)) {
    known.push({ targetId: target.id, isWolf: target.role === "人狼" });
    // 本番と同じく、初日の占いも夜の占いも妖狐を呪殺する。
    if (target.role === "妖狐") target.alive = false;
  }
  results.set(seer.id, known);
}

function latestKnownResult(
  state: SimulationState,
  results: Map<string, SeerResult[]>,
  seer: Player,
): SeerResult | undefined {
  const publishedIds = new Set(
    state.npcClaims
      .filter(
        (claim) =>
          claim.speakerId === seer.id && claim.claimedRole === "占い師",
      )
      .map((claim) => claim.targetId),
  );
  const known = [...(results.get(seer.id) ?? [])].reverse();
  return known.find((result) => !publishedIds.has(result.targetId)) ?? known[0];
}

function publishTrueSeerResult(
  state: SimulationState,
  results: Map<string, SeerResult[]>,
  seer: Player,
  day: number,
): void {
  const known = latestKnownResult(state, results, seer);
  if (!known) return;
  const target = state.players.find((player) => player.id === known.targetId);
  if (!target) return;
  const result: PublicResult = known.isWolf ? "人狼" : "人間";
  recordResultClaim(state, day, seer, "占い師", target, result);
  remember(state, seer.id, target.id, known.isWolf ? 6 : -3);
}

function publishMediumResult(
  state: SimulationState,
  medium: Player,
  day: number,
): void {
  const target = state.executionHistory.at(-1);
  if (!target) return;
  const result: PublicResult = target.role === "人狼" ? "人狼" : "人間";
  recordResultClaim(
    state,
    day,
    medium,
    "霊能者",
    target,
    result,
    state.executionHistory.length,
  );
}

function publishFakeSeerResult(
  state: SimulationState,
  speaker: Player,
  living: Player[],
  day: number,
  random: () => number,
): void {
  const available =
    speaker.role === "人狼"
      ? living.filter(
          (target) => target.id !== speaker.id && target.role !== "人狼",
        )
      : living.filter((target) => target.id !== speaker.id);
  if (!available.length) return;
  const claimedIds = new Set(
    state.npcClaims
      .filter(
        (claim) =>
          claim.speakerId === speaker.id && claim.claimedRole === "占い師",
      )
      .map((claim) => claim.targetId),
  );
  const fresh = available.filter((target) => !claimedIds.has(target.id));
  const target = randomItem(fresh.length ? fresh : available, random);
  const earlier = state.npcClaims.find(
    (claim) =>
      claim.speakerId === speaker.id &&
      claim.claimedRole === "占い師" &&
      claim.targetId === target.id,
  )?.result;
  const result: PublicResult =
    earlier ??
    (speaker.role === "狂人" && random() < MADMAN_WHITE_CLAIM_CHANCE
      ? "人間"
      : "人狼");
  recordResultClaim(state, day, speaker, "占い師", target, result);
  remember(state, speaker.id, target.id, result === "人狼" ? 2 : -1);
}

function chooseNpcSpeakers(
  state: SimulationState,
  living: Player[],
  random: () => number,
): Player[] {
  const npcs = living.filter((player) => player.isNpc);
  const priority = npcs.filter(
    (npc) =>
      npc.role === "占い師" ||
      (npc.role === "霊能者" && state.executionHistory.length > 0) ||
      seerClaimants(state.npcClaims).has(npc.id) ||
      npcSeerClaimPlanStartsOnDay(
        state.npcSeerClaimPlans.get(npc.id),
        state.day,
      ),
  );
  const selectedPriority = shuffled(priority, random);
  const priorityIds = new Set(priority.map((npc) => npc.id));
  const others = shuffled(
    npcs.filter((npc) => !priorityIds.has(npc.id)),
    random,
  ).slice(0, 3);
  return [...selectedPriority, ...others];
}

function decayMemory(state: SimulationState): void {
  const livingIds = new Set(
    state.players.filter((player) => player.alive).map((player) => player.id),
  );
  for (const memory of state.npcMemory.values()) {
    for (const [targetId, score] of memory) {
      if (!livingIds.has(targetId)) memory.delete(targetId);
      else if (Math.abs(score) < 0.25) memory.delete(targetId);
      else memory.set(targetId, score * 0.75);
    }
  }
}

function activeBlackTargets(state: SimulationState): {
  claimants: Set<string>;
  targets: Player[];
} {
  const claimants = seerClaimants(state.npcClaims);
  const targetIds = new Set<string>();
  for (const claimantId of claimants) {
    for (const [targetId, result] of latestResultsByTarget(
      state.npcClaims,
      claimantId,
    )) {
      if (result === "人狼") targetIds.add(targetId);
    }
  }
  return {
    claimants,
    targets: state.players.filter(
      (player) => player.alive && targetIds.has(player.id),
    ),
  };
}

function addVoteMemory(
  state: SimulationState,
  ballots: Array<{ voterId: string; targetId: string }>,
): void {
  const topIds = topVotedIds(ballots.map((ballot) => ballot.targetId));
  for (const npc of state.players.filter(
    (player) => player.alive && player.isNpc,
  )) {
    const targetId = ballots.find(
      (ballot) => ballot.voterId === npc.id,
    )?.targetId;
    if (targetId) remember(state, npc.id, targetId, 0.5);
    if (npc.npcPersonality === "同調") {
      for (const topId of topIds) {
        if (topId !== npc.id) remember(state, npc.id, topId, 0.4);
      }
    }
  }
}

function castBallots(
  state: SimulationState,
  living: Player[],
  candidates: Player[],
  random: () => number,
  firstRoundBallots?: Array<{ voterId: string; targetId: string }>,
): Array<{ voterId: string; targetId: string }> {
  const firstRoundCounts = new Map<string, number>();
  for (const ballot of firstRoundBallots ?? []) {
    firstRoundCounts.set(
      ballot.targetId,
      (firstRoundCounts.get(ballot.targetId) ?? 0) + 1,
    );
  }
  return living.map((player) => {
    const valid = candidates.filter((candidate) => candidate.id !== player.id);
    const choices = valid.length ? valid : candidates;
    const suspicion = npcDecisionSuspicion(state, player);
    return {
      voterId: player.id,
      targetId: firstRoundBallots
        ? chooseNpcRevoteTarget(
            player,
            choices,
            suspicion,
            firstRoundBallots.find((ballot) => ballot.voterId === player.id)
              ?.targetId,
            firstRoundCounts,
            random,
          )
        : chooseNpcVoteTarget(player, choices, suspicion, random),
    };
  });
}

function emptyResult(
  humanRole: RoleName,
  players: Player[],
): Omit<SimulationResult, "winner" | "days" | "humanAlive" | "timedOut"> {
  const roleAssigned = new Map<RoleName, number>();
  for (const player of players) {
    const role = player.role as RoleName;
    roleAssigned.set(role, (roleAssigned.get(role) ?? 0) + 1);
  }
  return {
    humanRole,
    loneBlackSituations: 0,
    loneBlackExecutions: 0,
    loneBlackVotes: 0,
    loneBlackBallots: 0,
    loneFalseBlackSituations: 0,
    loneFalseBlackExecutions: 0,
    contestedBlackSituations: 0,
    contestedBlackVotes: 0,
    contestedBlackBallots: 0,
    dayOneExecutions: 0,
    dayOneExecutionsWithoutBlackClaim: 0,
    ownClaimBallots: 0,
    ownClaimContradictions: 0,
    discussionBallots: 0,
    discussionVoteMatches: 0,
    roleAlive: new Map(),
    roleAssigned,
  };
}

function finishResult(
  base: Omit<SimulationResult, "winner" | "days" | "humanAlive" | "timedOut">,
  players: Player[],
  winner: Winner,
  days: number,
  timedOut: boolean,
): SimulationResult {
  const roleAlive = new Map<RoleName, number>();
  for (const player of players.filter((candidate) => candidate.alive)) {
    const role = player.role as RoleName;
    roleAlive.set(role, (roleAlive.get(role) ?? 0) + 1);
  }
  return {
    ...base,
    winner,
    days,
    humanAlive: players[0].alive,
    timedOut,
    roleAlive,
  };
}

export function simulateGame(
  roles: RoleName[],
  seed: number,
  humanCount = 1,
): SimulationResult {
  if (
    !Number.isInteger(humanCount) ||
    humanCount < 1 ||
    humanCount > roles.length
  ) {
    throw new Error(
      "人間プレイヤー数は1人以上かつ配役人数以下にしてください。",
    );
  }
  const random = seededRandom(seed);
  const claimPlanRandom = seededRandom(seed ^ 0x9e3779b9);
  const players: Player[] = [
    ...Array.from({ length: humanCount }, (_, index) => ({
      id: `human-${index}`,
      name: `Human${index}`,
      user: null,
      isNpc: false,
      alive: true,
    })),
    ...Array.from({ length: roles.length - humanCount }, (_, index) => ({
      id: `npc-${index}`,
      name: `NPC${index}`,
      user: null,
      isNpc: true,
      npcPersonality: personalityForSerial(index + 1),
      alive: true,
    })),
  ];
  const assignments = assignGameRoles(players, random, roles);
  for (const player of players) player.role = assignments.get(player.id);
  const humanRole = assignments.get("human-0") as RoleName;
  const result = emptyResult(humanRole, players);
  const state: SimulationState = {
    day: 0,
    players,
    roleConfig: roleConfigFromRoles(roles),
    npcSuspicion: new Map(),
    npcMemory: new Map(),
    npcClaims: [],
    npcSeerClaimPlans: planNpcSeerClaims(players, claimPlanRandom),
    humanSuspicions: new Map(),
    voteHistory: [],
    executionHistory: [],
  };
  const seerResults = new Map<string, SeerResult[]>();
  const seers = players.filter((player) => player.role === "占い師");
  for (const seer of seers) {
    const targets = players.filter((target) => target.id !== seer.id);
    if (targets.length)
      addSeerResult(seerResults, seer, randomItem(targets, random));
  }

  for (let day = 1; day <= 20; day += 1) {
    state.day = day;
    state.npcSuspicion.clear();
    state.humanSuspicions.clear();
    if (day > 1) decayMemory(state);
    const living = players.filter((player) => player.alive);
    const discussionTargets = new Map<string, string>();

    const humans = living.filter((player) => !player.isNpc);
    for (const human of humans) {
      if (human.role === "占い師") {
        const known = latestKnownResult(state, seerResults, human);
        const hasClaimed = seerClaimants(state.npcClaims).has(human.id);
        const claimChance = known?.isWolf ? 0.9 : hasClaimed ? 0.8 : 0.45;
        if (known && random() < claimChance) {
          publishTrueSeerResult(state, seerResults, human, day);
        }
      } else if (human.role === "霊能者") {
        publishMediumResult(state, human, day);
      }
    }

    for (const speaker of chooseNpcSpeakers(state, living, random)) {
      if (speaker.role === "霊能者") {
        publishMediumResult(state, speaker, day);
        continue;
      }
      if (speaker.role === "占い師") {
        publishTrueSeerResult(state, seerResults, speaker, day);
        continue;
      }
      const isContinuing = seerClaimants(state.npcClaims).has(speaker.id);
      const startsPlannedClaim = npcSeerClaimPlanStartsOnDay(
        state.npcSeerClaimPlans.get(speaker.id),
        day,
      );
      if (
        (speaker.role === "人狼" || speaker.role === "狂人") &&
        (isContinuing || startsPlannedClaim)
      ) {
        const resultCount =
          !isContinuing && state.npcSeerClaimPlans.get(speaker.id) === "day2"
            ? 2
            : 1;
        for (let index = 0; index < resultCount; index += 1)
          publishFakeSeerResult(state, speaker, living, day, random);
        continue;
      }

      const insight = findNpcInsight(
        state.npcClaims,
        state.voteHistory,
        speaker.id,
        new Set(living.map((player) => player.id)),
      );
      if (insight && living.some((player) => player.id === insight.suspectId)) {
        remember(state, speaker.id, insight.suspectId, 4);
        discussionTargets.set(speaker.id, insight.suspectId);
        continue;
      }
      const choices = living.filter((player) => player.id !== speaker.id);
      if (!choices.length) continue;
      const suspicion = npcDecisionSuspicion(state, speaker);
      const targetId = chooseNpcVoteTarget(speaker, choices, suspicion, random);
      remember(state, speaker.id, targetId, 1);
      discussionTargets.set(speaker.id, targetId);
    }

    for (const human of humans) {
      if (
        human.role === "占い師" &&
        !seerClaimants(state.npcClaims).has(human.id) &&
        seerClaimants(state.npcClaims).size > 0 &&
        random() < 0.9
      ) {
        publishTrueSeerResult(state, seerResults, human, day);
      }
      const knownWolf = (seerResults.get(human.id) ?? []).find(
        (known) =>
          known.isWolf && living.some((player) => player.id === known.targetId),
      );
      const leadingPublic = [...state.npcSuspicion]
        .filter(
          ([targetId, score]) =>
            targetId !== human.id &&
            score > 0 &&
            living.some((player) => player.id === targetId),
        )
        .sort((left, right) => right[1] - left[1])[0]?.[0];
      const targetId = knownWolf?.targetId ?? leadingPublic;
      if (targetId) {
        const hasPublicBlack = state.npcClaims.some(
          (claim) =>
            claim.claimedRole === "占い師" &&
            claim.targetId === targetId &&
            claim.result === "人狼",
        );
        state.humanSuspicions.set(human.id, {
          targetId,
          reason: hasPublicBlack ? "black-result" : "intuition",
        });
      }
    }

    const publicBlack = activeBlackTargets(state);
    const firstBallots = castBallots(state, living, living, random);
    for (const ballot of firstBallots) {
      const voter = living.find((player) => player.id === ballot.voterId);
      if (!voter?.isNpc) continue;
      const ownResults = latestResultsByTarget(state.npcClaims, voter.id);
      const ownBlackIds = new Set(
        [...ownResults]
          .filter(
            ([targetId, claimResult]) =>
              claimResult === "人狼" &&
              living.some((player) => player.id === targetId),
          )
          .map(([targetId]) => targetId),
      );
      const ownWhiteIds = new Set(
        [...ownResults]
          .filter(([, claimResult]) => claimResult === "人間")
          .map(([targetId]) => targetId),
      );
      const hasNonWhiteChoice = living.some(
        (candidate) =>
          candidate.id !== voter.id && !ownWhiteIds.has(candidate.id),
      );
      if (
        ownBlackIds.size > 0 ||
        (ownWhiteIds.has(ballot.targetId) && hasNonWhiteChoice)
      ) {
        result.ownClaimBallots += 1;
        if (
          (ownBlackIds.size > 0 && !ownBlackIds.has(ballot.targetId)) ||
          (ownWhiteIds.has(ballot.targetId) && hasNonWhiteChoice)
        ) {
          result.ownClaimContradictions += 1;
        }
      }
      const discussionTarget = discussionTargets.get(voter.id);
      if (discussionTarget) {
        result.discussionBallots += 1;
        if (discussionTarget === ballot.targetId) {
          result.discussionVoteMatches += 1;
        }
      }
    }

    const blackTargetIds = new Set(
      publicBlack.targets.map((target) => target.id),
    );
    const blackVotes = firstBallots.filter((ballot) =>
      blackTargetIds.has(ballot.targetId),
    ).length;
    if (publicBlack.targets.length > 0 && publicBlack.claimants.size === 1) {
      result.loneBlackSituations += 1;
      result.loneBlackVotes += blackVotes;
      result.loneBlackBallots += firstBallots.length;
      if (publicBlack.targets.some((target) => target.role !== "人狼")) {
        result.loneFalseBlackSituations += 1;
      }
    } else if (
      publicBlack.targets.length > 0 &&
      publicBlack.claimants.size >= 2
    ) {
      result.contestedBlackSituations += 1;
      result.contestedBlackVotes += blackVotes;
      result.contestedBlackBallots += firstBallots.length;
    }

    state.voteHistory.push({ day, round: 1, ballots: firstBallots });
    addVoteMemory(state, firstBallots);
    let outcome = resolveVoteOutcome(
      firstBallots.map((ballot) => ballot.targetId),
      1,
    );
    if (outcome.kind === "revote") {
      const tied = living.filter((player) =>
        outcome.kind === "revote"
          ? outcome.candidateIds.includes(player.id)
          : false,
      );
      const secondBallots = castBallots(
        state,
        living,
        tied,
        random,
        firstBallots,
      );
      state.voteHistory.push({ day, round: 2, ballots: secondBallots });
      addVoteMemory(state, secondBallots);
      outcome = resolveVoteOutcome(
        secondBallots.map((ballot) => ballot.targetId),
        2,
      );
    }

    let executed: Player | undefined;
    if (outcome.kind === "execute") {
      executed = players.find((player) => player.id === outcome.targetId);
      if (executed) {
        executed.alive = false;
        state.executionHistory.push(executed);
      }
    }
    if (day === 1 && executed) {
      result.dayOneExecutions += 1;
      if (publicBlack.targets.length === 0) {
        result.dayOneExecutionsWithoutBlackClaim += 1;
      }
    }
    if (
      executed &&
      publicBlack.claimants.size === 1 &&
      blackTargetIds.has(executed.id)
    ) {
      result.loneBlackExecutions += 1;
      if (executed.role !== "人狼") result.loneFalseBlackExecutions += 1;
    }

    const afterVote = getWinner(players);
    if (afterVote) {
      return finishResult(result, players, afterVote, day, false);
    }

    const nightLiving = players.filter((player) => player.alive);
    const victimTargets = nightLiving.filter(
      (player) => player.role !== "人狼",
    );
    const victim = chooseStrategicNightTarget(
      "kill",
      victimTargets,
      (playerId) => claimedRoleFor(state.npcClaims, playerId),
      random,
    );
    const guardedIds = new Set(
      nightLiving
        .filter((player) => player.role === "騎士")
        .map((guard) =>
          chooseStrategicNightTarget(
            "guard",
            nightLiving.filter((player) => player.id !== guard.id),
            (playerId) => claimedRoleFor(state.npcClaims, playerId),
            random,
          ),
        )
        .filter((guarded): guarded is Player => guarded !== undefined)
        .map((guarded) => guarded.id),
    );
    if (victim && victim.role !== "妖狐" && !guardedIds.has(victim.id))
      victim.alive = false;

    for (const seer of players.filter(
      (player) => player.alive && player.role === "占い師",
    )) {
      const uninspected = players.filter(
        (target) =>
          target.alive &&
          target.id !== seer.id &&
          !(seerResults.get(seer.id) ?? []).some(
            (known) => known.targetId === target.id,
          ),
      );
      if (uninspected.length) {
        addSeerResult(seerResults, seer, randomItem(uninspected, random));
      }
    }

    const afterNight = getWinner(players);
    if (afterNight) {
      return finishResult(result, players, afterNight, day, false);
    }
  }

  const fallbackWinner = getWinner(players) ?? "wolf";
  return finishResult(result, players, fallbackWinner, 20, true);
}

function madmanRoles(playerCount: number): RoleName[] | null {
  const roles = buildSoloRoles(playerCount);
  const villagerIndex = roles.lastIndexOf("村人");
  if (villagerIndex < 0) return null;
  roles[villagerIndex] = "狂人";
  const wolfTeam = roles.filter(
    (role) => role === "人狼" || role === "狂人",
  ).length;
  if (wolfTeam >= roles.length - wolfTeam) return null;
  return roles;
}

function doubleSeerRoles(playerCount: number): RoleName[] | null {
  if (playerCount < 5) return null;
  const roles = buildRoles(playerCount);
  const wolfCount = roles.filter((role) => role === "人狼").length;
  const villagerIndexes = roles.flatMap((role, index) =>
    role === "村人" ? [index] : [],
  );
  const requiredVillagers = wolfCount < 2 ? 2 : 1;
  if (villagerIndexes.length < requiredVillagers) return null;
  if (wolfCount < 2) {
    const wolfIndex = villagerIndexes.shift();
    if (wolfIndex === undefined) return null;
    roles[wolfIndex] = "人狼";
  }
  const seerIndex = villagerIndexes.shift();
  if (seerIndex === undefined) return null;
  roles[seerIndex] = "占い師";
  return roles;
}

function doubleSeerMadmanRoles(playerCount: number): RoleName[] | null {
  if (playerCount < 7) return null;
  const roles: RoleName[] = [
    "人狼",
    "人狼",
    "狂人",
    "占い師",
    "占い師",
    "騎士",
    "霊能者",
  ];
  while (roles.length < playerCount) roles.push("村人");
  return roles;
}

function tripleSeerRoles(playerCount: number): RoleName[] | null {
  if (playerCount < 7) return null;
  const roles: RoleName[] = [
    "人狼",
    "人狼",
    "人狼",
    "占い師",
    "占い師",
    "占い師",
  ];
  if (playerCount >= 8) roles.push("騎士");
  if (playerCount >= 9) roles.push("霊能者");
  while (roles.length < playerCount) roles.push("村人");
  return roles;
}

function doubleMadmanRoles(playerCount: number): RoleName[] | null {
  if (playerCount < 7) return null;
  const roles: RoleName[] = [
    "人狼",
    "狂人",
    "狂人",
    "占い師",
    "騎士",
    "霊能者",
  ];
  if (playerCount >= 9) roles.push("人狼");
  while (roles.length < playerCount) roles.push("村人");
  return roles;
}

function doubleGuardRoles(playerCount: number): RoleName[] | null {
  if (playerCount < 7) return null;
  const roles = buildRoles(playerCount);
  const villagerIndex = roles.lastIndexOf("村人");
  if (villagerIndex < 0) return null;
  roles[villagerIndex] = "騎士";
  return roles;
}

function maximumMultiRoleConfig(playerCount: number): RoleName[] | null {
  if (playerCount < 11) return null;
  const roles: RoleName[] = [
    "人狼",
    "人狼",
    "人狼",
    "狂人",
    "狂人",
    "占い師",
    "占い師",
    "占い師",
    "騎士",
    "霊能者",
  ];
  while (roles.length < playerCount) roles.push("村人");
  return roles;
}

export function buildPlaytestScenarios(): PlaytestScenario[] {
  const scenarios: PlaytestScenario[] = [];
  for (let playerCount = 4; playerCount <= 15; playerCount += 1) {
    scenarios.push({
      name: `ソロ${playerCount}人`,
      profile: "ソロ標準",
      roles: buildSoloRoles(playerCount),
      humanCount: 1,
    });
    scenarios.push({
      name: `通常${playerCount}人`,
      profile: "通常配役",
      roles: buildRoles(playerCount),
      humanCount: 2,
    });
    const withMadman = madmanRoles(playerCount);
    if (withMadman) {
      scenarios.push({
        name: `狂人${playerCount}人`,
        profile: "狂人入り",
        roles: withMadman,
        humanCount: 1,
      });
    }
    const withTwoSeers = doubleSeerRoles(playerCount);
    if (withTwoSeers) {
      scenarios.push({
        name: `占い2-${playerCount}人`,
        profile: "複数占い",
        roles: withTwoSeers,
        humanCount: 1,
      });
    }
    const withTwoSeersAndMadman = doubleSeerMadmanRoles(playerCount);
    if (withTwoSeersAndMadman) {
      scenarios.push({
        name: `占い2狂-${playerCount}人`,
        profile: "複数占い",
        roles: withTwoSeersAndMadman,
        humanCount: 1,
      });
    }
    const withThreeSeers = tripleSeerRoles(playerCount);
    if (withThreeSeers) {
      scenarios.push({
        name: `占い3-${playerCount}人`,
        profile: "複数占い",
        roles: withThreeSeers,
        humanCount: 1,
      });
    }
    const withTwoMadmen = doubleMadmanRoles(playerCount);
    if (withTwoMadmen) {
      scenarios.push({
        name: `狂人2-${playerCount}人`,
        profile: "複数狂人",
        roles: withTwoMadmen,
        humanCount: 1,
      });
    }
    const withTwoGuards = doubleGuardRoles(playerCount);
    if (withTwoGuards) {
      scenarios.push({
        name: `騎士2-${playerCount}人`,
        profile: "複数騎士",
        roles: withTwoGuards,
        humanCount: 1,
      });
    }
    const maximumConfig = maximumMultiRoleConfig(playerCount);
    if (maximumConfig) {
      scenarios.push({
        name: `複数最大-${playerCount}人`,
        profile: "複数狂人",
        roles: maximumConfig,
        humanCount: 1,
      });
    }
  }
  scenarios.push(
    {
      name: "自由逆村7人",
      profile: "自由配役",
      roles: ["人狼", "人狼", "狂人", "狂人", "狂人", "占い師", "騎士"],
      humanCount: 1,
    },
    {
      name: "自由霊能3-11人",
      profile: "自由配役",
      roles: [
        "人狼",
        "人狼",
        "狂人",
        "占い師",
        "占い師",
        "騎士",
        "騎士",
        "霊能者",
        "霊能者",
        "霊能者",
        "村人",
      ],
      humanCount: 1,
    },
    {
      name: "自由上限15人",
      profile: "自由配役",
      roles: [
        "人狼",
        "人狼",
        "人狼",
        "狂人",
        "狂人",
        "狂人",
        "狂人",
        "狂人",
        "占い師",
        "占い師",
        "騎士",
        "騎士",
        "霊能者",
        "霊能者",
        "村人",
      ],
      humanCount: 1,
    },
  );
  return scenarios;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function runScenario(
  scenario: PlaytestScenario,
  trials: number,
  seedOffset = 0,
): ScenarioSummary {
  const results = Array.from({ length: trials }, (_, index) =>
    simulateGame(
      scenario.roles,
      seedOffset + index * 97 + scenario.roles.length * 10_007,
      scenario.humanCount,
    ),
  );
  const sum = (select: (result: SimulationResult) => number): number =>
    results.reduce((total, result) => total + select(result), 0);
  const roleAssigned = new Map<RoleName, number>();
  const roleAlive = new Map<RoleName, number>();
  for (const result of results) {
    for (const [role, count] of result.roleAssigned) {
      roleAssigned.set(role, (roleAssigned.get(role) ?? 0) + count);
    }
    for (const [role, count] of result.roleAlive) {
      roleAlive.set(role, (roleAlive.get(role) ?? 0) + count);
    }
  }
  const roleSurvivalRates = new Map<RoleName, number>();
  for (const [role, assigned] of roleAssigned) {
    roleSurvivalRates.set(role, (roleAlive.get(role) ?? 0) / assigned);
  }
  const dayOneExecutions = sum((result) => result.dayOneExecutions);
  const loneBlackSituations = sum((result) => result.loneBlackSituations);
  const loneFalseBlackSituations = sum(
    (result) => result.loneFalseBlackSituations,
  );
  return {
    scenario,
    trials,
    villageWinRate:
      results.filter((result) => result.winner === "villager").length / trials,
    averageDays: sum((result) => result.days) / trials,
    humanSurvivalRate:
      results.filter((result) => result.humanAlive).length / trials,
    timeoutRate: results.filter((result) => result.timedOut).length / trials,
    loneBlackExecutionRate: ratio(
      sum((result) => result.loneBlackExecutions),
      loneBlackSituations,
    ),
    loneBlackVoteRate: ratio(
      sum((result) => result.loneBlackVotes),
      sum((result) => result.loneBlackBallots),
    ),
    loneFalseBlackExecutionRate: ratio(
      sum((result) => result.loneFalseBlackExecutions),
      loneFalseBlackSituations,
    ),
    contestedBlackVoteRate: ratio(
      sum((result) => result.contestedBlackVotes),
      sum((result) => result.contestedBlackBallots),
    ),
    dayOneNoBlackClaimExecutionRate: ratio(
      sum((result) => result.dayOneExecutionsWithoutBlackClaim),
      dayOneExecutions,
    ),
    ownClaimContradictionRate: ratio(
      sum((result) => result.ownClaimContradictions),
      sum((result) => result.ownClaimBallots),
    ),
    discussionVoteMatchRate: ratio(
      sum((result) => result.discussionVoteMatches),
      sum((result) => result.discussionBallots),
    ),
    roleSurvivalRates,
  };
}
