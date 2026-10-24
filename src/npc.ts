import type {
  GameState,
  HumanArgument,
  HumanArgumentReason,
  NpcPersonality,
  NpcSeerClaimPlan,
  Player,
  PublicResult,
  RoleClaim,
  RoleName,
  VoteRecord,
} from "./types";
import { isActualWolfRole, isWolfTeamRole, ROLE_INFO } from "./roles";

export const NPC_PERSONALITIES: NpcPersonality[] = [
  "慎重",
  "直感",
  "追及",
  "同調",
];

export const MADMAN_WHITE_CLAIM_CHANCE = 0.45;

export function chooseNpcSeerClaimPlan(
  role: RoleName,
  wolfCount: number,
  random: () => number = Math.random,
): NpcSeerClaimPlan {
  const roll = random();
  const day1Chance =
    role === "てるてる"
      ? 0.7
      : role === "狂人"
        ? 0.45
        : wolfCount === 1
          ? 0.3
          : 0.2;
  const day2Chance = role === "てるてる" ? 0.2 : role === "狂人" ? 0.25 : 0.1;
  if (roll < day1Chance) return "day1";
  if (roll < day1Chance + day2Chance) return "day2";
  return "never";
}

export function planNpcSeerClaims(
  players: Player[],
  random: () => number = Math.random,
): Map<string, NpcSeerClaimPlan> {
  const seerCount = players.filter((player) => player.role === "占い師").length;
  if (seerCount === 0) return new Map();

  const wolfCount = players.filter((player) =>
    isActualWolfRole(player.role),
  ).length;
  return new Map(
    players
      .filter(
        (player) =>
          player.isNpc &&
          (isWolfTeamRole(player.role) || player.role === "てるてる"),
      )
      .map((player) => [
        player.id,
        chooseNpcSeerClaimPlan(player.role as RoleName, wolfCount, random),
      ]),
  );
}

export function npcSeerClaimPlanStartsOnDay(
  plan: NpcSeerClaimPlan | undefined,
  day: number,
): boolean {
  return (plan === "day1" && day === 1) || (plan === "day2" && day === 2);
}

const MADMAN_COUNTER_WEIGHT = 0.35;
const PUBLIC_BLACK_CLAIM_SCORE = 1.25;
const PUBLIC_WHITE_CLAIM_SCORE = -0.4;
const LONE_SEER_BLACK_BONUS = 2.5;
const MULTI_SEER_BLACK_BONUS_PER_CLAIM = 0.75;
const OWN_BLACK_CLAIM_BONUS = 8;
const OWN_WHITE_CLAIM_PENALTY = -8;
const MAX_SHARED_ARGUMENT_SCORE = 4;
const MAX_SHARED_SUSPICION = 2.5;
const DISPROVED_BLACK_CLAIM_SCORE = 1;
const LONE_DAY_ONE_SEER_PROTECTION = 2.5;

export const HUMAN_ARGUMENT_REASONS: HumanArgumentReason[] = [
  "black-result",
  "vote-contradiction",
  "broken-claim",
  "counter-claim",
  "previous-votes",
  "intuition",
];

export interface NpcInsight {
  suspectId: string;
  reason: string;
}

export interface NpcQuestionAnswer {
  targetId?: string;
  reason: string;
}

const persuasionReplies = new WeakMap<object, Set<string>>();

/** 回答が実際に変わったときだけ、1人の発言者につき1日1回反応する。 */
export function takeNpcPersuasionReaction(
  game: NpcDecisionContext,
  speakerId: string,
  before: ReadonlyMap<string, NpcQuestionAnswer | null>,
): { npcId: string; targetId: string; reason: string } | null {
  const argument = game.humanSuspicions.get(speakerId);
  if (
    !argument ||
    argument.reason === "intuition" ||
    !game.players.some(
      (player) => player.id === speakerId && player.alive && !player.isNpc,
    ) ||
    !isHumanArgumentSupported(game, argument)
  )
    return null;
  const key = `${game.day}:${speakerId}`;
  const sent = persuasionReplies.get(game) ?? new Set<string>();
  if (sent.has(key)) return null;
  for (const npc of game.players) {
    if (!npc.isNpc || !npc.alive || !before.has(npc.id)) continue;
    const previous = before.get(npc.id);
    const answer = chooseNpcQuestionAnswer(game, npc);
    if (!previous?.targetId || previous.targetId === answer?.targetId) continue;
    if (answer?.targetId !== argument.targetId) continue;
    sent.add(key);
    persuasionReplies.set(game, sent);
    return { npcId: npc.id, targetId: answer.targetId, reason: answer.reason };
  }
  return null;
}

type NpcQuestionContext = NpcDecisionContext;

type NpcDecisionContext = Pick<
  GameState,
  | "day"
  | "players"
  | "roleConfig"
  | "npcSuspicion"
  | "npcMemory"
  | "npcClaims"
  | "humanSuspicions"
  | "executionHistory"
  | "voteHistory"
>;

type HumanArgumentContext = Pick<
  GameState,
  | "day"
  | "players"
  | "roleConfig"
  | "npcClaims"
  | "voteHistory"
  | "executionHistory"
>;

type ResultClaimRole = RoleClaim["claimedRole"];

export function roleClaimantIds(
  claims: RoleClaim[],
  role: ResultClaimRole,
): Set<string> {
  return new Set(
    claims
      .filter((claim) => claim.claimedRole === role)
      .map((claim) => claim.speakerId),
  );
}

function roleClaimCapacity(
  game: Pick<HumanArgumentContext, "roleConfig">,
  role: ResultClaimRole,
): number {
  return game.roleConfig[role];
}

export function isRoleClaimOverCapacity(
  game: Pick<HumanArgumentContext, "roleConfig" | "npcClaims">,
  role: ResultClaimRole,
): boolean {
  return (
    roleClaimantIds(game.npcClaims, role).size > roleClaimCapacity(game, role)
  );
}

export function conflictingSeerClaimantIds(claims: RoleClaim[]): Set<string> {
  const byTarget = new Map<string, { 人狼: Set<string>; 人間: Set<string> }>();
  for (const claim of claims) {
    if (claim.claimedRole !== "占い師") continue;
    const results = byTarget.get(claim.targetId) ?? {
      人狼: new Set<string>(),
      人間: new Set<string>(),
    };
    results[claim.result].add(claim.speakerId);
    byTarget.set(claim.targetId, results);
  }

  const conflicting = new Set<string>();
  for (const results of byTarget.values()) {
    if (results.人狼.size === 0 || results.人間.size === 0) continue;
    for (const claimantId of [...results.人狼, ...results.人間])
      conflicting.add(claimantId);
  }
  return conflicting;
}

export function claimConcernForPlayer(
  game: Pick<HumanArgumentContext, "roleConfig" | "npcClaims">,
  speakerId: string,
): "over-capacity" | "result-conflict" | undefined {
  const claimedRoles = new Set(
    game.npcClaims
      .filter((claim) => claim.speakerId === speakerId)
      .map((claim) => claim.claimedRole),
  );
  if ([...claimedRoles].some((role) => isRoleClaimOverCapacity(game, role)))
    return "over-capacity";
  if (conflictingSeerClaimantIds(game.npcClaims).has(speakerId))
    return "result-conflict";
  return undefined;
}

function logicallyDisprovedSeerIds(game: HumanArgumentContext): Set<string> {
  const initialWolfCount = Object.entries(game.roleConfig).reduce(
    (total, [role, count]) =>
      total + (isActualWolfRole(role as RoleName) ? count : 0),
    0,
  );
  // 狼憑きは真占いでも黒。呪われた村人は試合中に人狼へ変わり得る。
  // 配役として公開された可能性を考慮し、秘密の割当・変化は参照しない。
  const extraBlackCapacity =
    (game.roleConfig.狼憑き ?? 0) + (game.roleConfig.呪われた村人 ?? 0);
  const blackTargetsByClaimant = new Map<string, Set<string>>();
  for (const claim of game.npcClaims) {
    if (claim.claimedRole !== "占い師" || claim.result !== "人狼") continue;
    const targets = blackTargetsByClaimant.get(claim.speakerId) ?? new Set();
    targets.add(claim.targetId);
    blackTargetsByClaimant.set(claim.speakerId, targets);
  }

  const executedIds = new Set(game.executionHistory.map((player) => player.id));
  const disproved = new Set<string>();
  for (const [claimantId, blackTargetIds] of blackTargetsByClaimant) {
    const tooManyBlackResults =
      blackTargetIds.size > initialWolfCount + extraBlackCapacity;
    const executedBlackDidNotEndGame =
      initialWolfCount === 1 &&
      extraBlackCapacity === 0 &&
      [...blackTargetIds].some((targetId) => executedIds.has(targetId));
    if (tooManyBlackResults || executedBlackDidNotEndGame) {
      disproved.add(claimantId);
    }
  }
  return disproved;
}

export function credibleLoneDayOneSeerId(
  game: HumanArgumentContext & Pick<GameState, "humanSuspicions">,
): string | undefined {
  if (game.day !== 1 || game.roleConfig.占い師 < 1) return undefined;
  const claimantIds = roleClaimantIds(game.npcClaims, "占い師");
  if (claimantIds.size !== 1 || isRoleClaimOverCapacity(game, "占い師"))
    return undefined;
  const claimantId = [...claimantIds][0];
  const claimant = game.players.find((player) => player.id === claimantId);
  if (!claimant?.alive) return undefined;
  if (logicallyDisprovedSeerIds(game).has(claimantId)) return undefined;
  if (conflictingSeerClaimantIds(game.npcClaims).has(claimantId))
    return undefined;
  const hasSupportedContradiction = [...game.humanSuspicions.values()].some(
    (argument) =>
      argument.targetId === claimantId &&
      argument.reason !== "intuition" &&
      isHumanArgumentSupported(game, argument),
  );
  return hasSupportedContradiction ? undefined : claimantId;
}

function hasClaimVoteContradiction(
  game: Pick<HumanArgumentContext, "npcClaims" | "voteHistory" | "players">,
  speakerId: string,
): boolean {
  return (
    claimVoteInsight(
      game.npcClaims,
      game.voteHistory,
      speakerId,
      new Set(
        game.players
          .filter((player) => player.alive)
          .map((player) => player.id),
      ),
    ) !== null
  );
}

export function isHumanArgumentSupported(
  game: HumanArgumentContext,
  argument: HumanArgument,
): boolean {
  if (argument.reason === "intuition") return true;
  if (argument.reason === "black-result") {
    return game.npcClaims.some(
      (claim) =>
        claim.claimedRole === "占い師" &&
        claim.targetId === argument.targetId &&
        claim.result === "人狼",
    );
  }
  if (argument.reason === "vote-contradiction") {
    return hasClaimVoteContradiction(game, argument.targetId);
  }
  if (argument.reason === "broken-claim") {
    return logicallyDisprovedSeerIds(game).has(argument.targetId);
  }
  if (argument.reason === "counter-claim") {
    return claimConcernForPlayer(game, argument.targetId) !== undefined;
  }
  const previousVotes = latestVoteRound(game.voteHistory, game.day - 1);
  return (
    (previousVotes?.ballots.filter(
      (ballot) => ballot.targetId === argument.targetId,
    ).length ?? 0) >= 2
  );
}

export function humanArgumentScore(
  game: HumanArgumentContext,
  argument: HumanArgument,
): number {
  if (!isHumanArgumentSupported(game, argument)) return 0;
  if (argument.reason === "broken-claim") return 4;
  if (argument.reason === "vote-contradiction") return 2;
  if (argument.reason === "black-result") return 0.75;
  if (argument.reason === "counter-claim") return 0.6;
  if (argument.reason === "previous-votes") return 0.4;
  return 0.3;
}

export function addPublicClaimSuspicion(
  suspicion: Map<string, number>,
  targetId: string,
  result: PublicResult,
): void {
  const amount =
    result === "人狼" ? PUBLIC_BLACK_CLAIM_SCORE : PUBLIC_WHITE_CLAIM_SCORE;
  suspicion.set(
    targetId,
    Math.max(
      -MAX_SHARED_SUSPICION,
      Math.min(MAX_SHARED_SUSPICION, (suspicion.get(targetId) ?? 0) + amount),
    ),
  );
}

function latestSeerResults(
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

function argumentWeight(npc: Player, reason: HumanArgumentReason): number {
  const personality = npc.npcPersonality ?? "慎重";
  if (reason === "intuition") {
    return personality === "直感" ? 1.2 : personality === "追及" ? 0.25 : 0.5;
  }
  if (reason === "vote-contradiction" || reason === "broken-claim") {
    return personality === "追及" ? 1.2 : personality === "直感" ? 0.8 : 1;
  }
  return personality === "同調" ? 1.15 : 1;
}

/** 対抗がいるときだけ、公開された投票との矛盾でCOの信用を更新する。 */
function addContestedClaimEvidence(
  game: NpcDecisionContext,
  npc: Player,
  scores: Map<string, number>,
): void {
  const claimants = roleClaimantIds(game.npcClaims, "占い師");
  const conflicts = conflictingSeerClaimantIds(game.npcClaims);
  if (claimants.size <= game.roleConfig.占い師 && conflicts.size === 0) return;
  const personality = npc.npcPersonality ?? "慎重";
  const distrust =
    personality === "追及" ? 0.8 : personality === "慎重" ? 0.65 : 0.4;
  const corrections = new Map<string, number>();
  for (const claimantId of claimants) {
    if (!hasClaimVoteContradiction(game, claimantId)) continue;
    // 偽かどうかは参照しない。白先への投票など、公開された行動だけを見る。
    scores.set(claimantId, (scores.get(claimantId) ?? 0) + distrust * 1.5);
    for (const [targetId, result] of latestSeerResults(
      game.npcClaims,
      claimantId,
    )) {
      const signal =
        result === "人狼" ? PUBLIC_BLACK_CLAIM_SCORE : PUBLIC_WHITE_CLAIM_SCORE;
      corrections.set(
        targetId,
        (corrections.get(targetId) ?? 0) - signal * distrust,
      );
    }
  }
  for (const [targetId, correction] of corrections) {
    // CO人数・結果の連投で信用補正が際限なく増幅しないようにする。
    const bounded = Math.max(
      -PUBLIC_BLACK_CLAIM_SCORE,
      Math.min(PUBLIC_BLACK_CLAIM_SCORE, correction),
    );
    scores.set(targetId, (scores.get(targetId) ?? 0) + bounded);
  }
}

export function npcDecisionSuspicion(
  game: NpcDecisionContext,
  npc: Player,
): ReadonlyMap<string, number> {
  const sharedSignals = new Map(game.npcSuspicion);
  addContestedClaimEvidence(game, npc, sharedSignals);
  const disprovedSeerIds = new Set<string>();
  const explainedDisprovedIds = new Set(
    [...game.humanSuspicions.values()]
      .filter(
        (argument) =>
          argument.reason === "broken-claim" &&
          isHumanArgumentSupported(game, argument),
      )
      .map((argument) => argument.targetId),
  );

  for (const claimantId of logicallyDisprovedSeerIds(game)) {
    const claimant = game.players.find((player) => player.id === claimantId);
    if (!claimant?.alive) continue;
    const noticed =
      npc.npcPersonality === "追及" || explainedDisprovedIds.has(claimant.id);
    if (!noticed) continue;
    disprovedSeerIds.add(claimant.id);
    sharedSignals.set(
      claimant.id,
      Math.max(
        sharedSignals.get(claimant.id) ?? 0,
        DISPROVED_BLACK_CLAIM_SCORE,
      ),
    );
  }

  const argumentScores = new Map<string, number>();
  for (const [speakerId, argument] of game.humanSuspicions) {
    if (!game.players.some((player) => player.id === speakerId && player.alive))
      continue;
    const score =
      humanArgumentScore(game, argument) * argumentWeight(npc, argument.reason);
    if (score > 0) {
      argumentScores.set(
        argument.targetId,
        Math.min(
          MAX_SHARED_ARGUMENT_SCORE,
          (argumentScores.get(argument.targetId) ?? 0) + score,
        ),
      );
      continue;
    }

    const speaker = game.players.find((player) => player.id === speakerId);
    if (!speaker?.alive) continue;
    const baselessPenalty =
      npc.npcPersonality === "追及"
        ? 1.2
        : npc.npcPersonality === "慎重"
          ? 0.6
          : npc.npcPersonality === "同調"
            ? 0.4
            : 0.2;
    sharedSignals.set(
      speaker.id,
      (sharedSignals.get(speaker.id) ?? 0) + baselessPenalty,
    );
  }
  for (const [targetId, score] of argumentScores) {
    const publicScore = sharedSignals.get(targetId) ?? 0;
    sharedSignals.set(
      targetId,
      Math.min(MAX_SHARED_ARGUMENT_SCORE, publicScore + score),
    );
  }

  const seerClaimants = new Set(
    game.npcClaims
      .filter(
        (claim) =>
          claim.claimedRole === "占い師" &&
          !disprovedSeerIds.has(claim.speakerId),
      )
      .map((claim) => claim.speakerId),
  );
  const seerCapacity = game.roleConfig.占い師;
  if (
    seerCapacity > 0 &&
    seerClaimants.size > 0 &&
    seerClaimants.size <= seerCapacity
  ) {
    const resultsByTarget = new Map<
      string,
      { blackClaimants: Set<string>; whiteClaimants: Set<string> }
    >();
    for (const claimantId of seerClaimants) {
      for (const [targetId, result] of latestSeerResults(
        game.npcClaims,
        claimantId,
      )) {
        const targetResults = resultsByTarget.get(targetId) ?? {
          blackClaimants: new Set<string>(),
          whiteClaimants: new Set<string>(),
        };
        (result === "人狼"
          ? targetResults.blackClaimants
          : targetResults.whiteClaimants
        ).add(claimantId);
        resultsByTarget.set(targetId, targetResults);
      }
    }
    for (const [targetId, targetResults] of resultsByTarget) {
      if (
        targetResults.blackClaimants.size === 0 ||
        targetResults.whiteClaimants.size > 0
      )
        continue;
      const target = game.players.find((player) => player.id === targetId);
      if (!target?.alive) continue;
      const bonus =
        seerCapacity === 1
          ? LONE_SEER_BLACK_BONUS
          : Math.min(
              LONE_SEER_BLACK_BONUS,
              targetResults.blackClaimants.size *
                MULTI_SEER_BLACK_BONUS_PER_CLAIM,
            );
      sharedSignals.set(targetId, (sharedSignals.get(targetId) ?? 0) + bonus);
    }
  }

  const publicSuspicion =
    npc.role === "狂人" && game.roleConfig.人狼 === 1
      ? new Map(
          [...sharedSignals].map(([targetId, score]) => [
            targetId,
            -score * MADMAN_COUNTER_WEIGHT,
          ]),
        )
      : sharedSignals;
  const result = combinedSuspicion(
    publicSuspicion,
    game.npcMemory.get(npc.id) ?? new Map(),
    npc.npcPersonality ?? "慎重",
  );

  const loneSeerId = credibleLoneDayOneSeerId(game);
  if (
    loneSeerId &&
    npc.role !== undefined &&
    ROLE_INFO[npc.role].team === "villager"
  ) {
    result.set(
      loneSeerId,
      (result.get(loneSeerId) ?? 0) - LONE_DAY_ONE_SEER_PROTECTION,
    );
  }

  const ownResults = latestSeerResults(game.npcClaims, npc.id);
  const ownBlackIds = new Set<string>();
  const ownWhiteIds = new Set<string>();
  for (const [targetId, claimResult] of ownResults) {
    const target = game.players.find((player) => player.id === targetId);
    if (!target?.alive) continue;
    if (claimResult === "人狼") ownBlackIds.add(targetId);
    else ownWhiteIds.add(targetId);
    result.set(
      targetId,
      (result.get(targetId) ?? 0) +
        (claimResult === "人狼"
          ? OWN_BLACK_CLAIM_BONUS
          : OWN_WHITE_CLAIM_PENALTY),
    );
  }
  if (ownBlackIds.size > 0) {
    const strongestOther = Math.max(
      0,
      ...[...result]
        .filter(([targetId]) => !ownBlackIds.has(targetId))
        .map(([, score]) => score),
    );
    for (const targetId of ownBlackIds) {
      result.set(
        targetId,
        Math.max(result.get(targetId) ?? 0, strongestOther + 4),
      );
    }
  } else if (ownWhiteIds.size > 0) {
    const strongestAlternative = Math.max(
      ...[...result]
        .filter(([targetId]) => !ownWhiteIds.has(targetId))
        .map(([, score]) => score),
    );
    if (Number.isFinite(strongestAlternative)) {
      for (const targetId of ownWhiteIds) {
        result.set(
          targetId,
          Math.min(result.get(targetId) ?? 0, strongestAlternative - 4),
        );
      }
    }
  }
  return result;
}

export function chooseStrategicNightTarget(
  action: "kill" | "guard",
  targets: Player[],
  claimedRoleFor: (playerId: string) => RoleName | undefined,
  random: () => number = Math.random,
): Player | undefined {
  return [...targets]
    .map((target) => {
      const claimedRole = claimedRoleFor(target.id);
      const roleScore =
        claimedRole === "占い師"
          ? 3
          : claimedRole === "霊能者"
            ? 2
            : claimedRole === "騎士"
              ? 1.25
              : 0;
      const humanScore = target.isNpc ? 0 : 0.25;
      const score =
        action === "kill"
          ? roleScore * 0.65 + humanScore + random() * 2.5
          : roleScore * 0.85 + random() * 2;
      return { target, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.target;
}

export function personalityForSerial(serial: number): NpcPersonality {
  return NPC_PERSONALITIES[
    (Math.max(1, serial) - 1) % NPC_PERSONALITIES.length
  ];
}

export function combinedSuspicion(
  shared: ReadonlyMap<string, number>,
  memory: ReadonlyMap<string, number>,
  personality: NpcPersonality,
): Map<string, number> {
  const result = new Map<string, number>();
  const sharedWeight =
    personality === "慎重"
      ? 0.45
      : personality === "直感"
        ? 0.65
        : personality === "追及"
          ? 0.8
          : 1.2;
  const memoryWeight = personality === "追及" ? 1.5 : 1;
  for (const [id, score] of shared) result.set(id, score * sharedWeight);
  for (const [id, score] of memory) {
    result.set(id, (result.get(id) ?? 0) + score * memoryWeight);
  }
  return result;
}

function latestBallot(
  history: VoteRecord[],
  day: number,
  voterId: string,
): { voterId: string; targetId: string } | undefined {
  return [...history]
    .filter((record) => record.day === day)
    .sort((left, right) => right.round - left.round)
    .flatMap((record) => record.ballots)
    .find((ballot) => ballot.voterId === voterId);
}

function claimVoteInsight(
  claims: RoleClaim[],
  voteHistory: VoteRecord[],
  speakerId: string,
  aliveIds: ReadonlySet<string>,
): NpcInsight | null {
  const days = new Set(
    claims
      .filter(
        (claim) =>
          claim.speakerId === speakerId && claim.claimedRole === "占い師",
      )
      .map((claim) => claim.day),
  );
  for (const day of days) {
    const ballot = latestBallot(voteHistory, day, speakerId);
    if (!ballot) continue;
    const results = latestSeerResults(
      claims.filter((claim) => claim.day <= day),
      speakerId,
    );
    if (results.get(ballot.targetId) === "人間") {
      return {
        suspectId: speakerId,
        reason: "人間判定を出した相手へ投票していた",
      };
    }
    const round = latestVoteRound(voteHistory, day);
    const hasAvailableBlack = [...results].some(
      ([targetId, result]) =>
        result === "人狼" &&
        (aliveIds.has(targetId) ||
          round?.ballots.some((vote) => vote.voterId === targetId)),
    );
    // 複数の黒先のどれかに投票した場合や、黒先が既に死亡していた場合は矛盾にしない。
    if (hasAvailableBlack && results.get(ballot.targetId) !== "人狼") {
      return {
        suspectId: speakerId,
        reason: "人狼判定を出した相手とは別の人へ投票していた",
      };
    }
  }
  return null;
}

export function findNpcInsight(
  claims: RoleClaim[],
  voteHistory: VoteRecord[],
  observerId: string,
  aliveIds: ReadonlySet<string>,
): NpcInsight | null {
  const visibleClaims = claims.filter(
    (claim) => claim.speakerId !== observerId && aliveIds.has(claim.speakerId),
  );

  for (const speakerId of new Set(
    [...visibleClaims]
      .reverse()
      .filter((claim) => claim.claimedRole === "占い師")
      .map((claim) => claim.speakerId),
  )) {
    const insight = claimVoteInsight(
      claims,
      voteHistory,
      speakerId,
      new Set([...aliveIds, observerId]),
    );
    if (insight) return insight;
  }

  // 判定の食い違いや対抗COだけでは、どちらが偽物かは決められない。
  // 発言順だけで後から出た側を疑うことを避け、投票との矛盾など
  // 本人の行動に根拠がある場合だけ疑いへ変換する。

  return null;
}

function latestVoteRound(
  history: VoteRecord[],
  day: number,
): VoteRecord | undefined {
  return history
    .filter((record) => record.day === day)
    .sort((left, right) => right.round - left.round)[0];
}

function stableNpcHash(npcId: string, day: number): number {
  let hash = day * 31;
  for (const character of npcId) hash = hash * 33 + character.charCodeAt(0);
  return Math.abs(hash);
}

function stableCandidateIndex(
  npcId: string,
  day: number,
  length: number,
): number {
  return stableNpcHash(npcId, day) % length;
}

function genericQuestionReason(personality: NpcPersonality): string {
  if (personality === "慎重")
    return "まだ決め手はないが、今日は発言をよく見たい";
  if (personality === "直感")
    return "根拠は薄いが、今のところ一番気になっている";
  if (personality === "追及") return "まだ説明が足りないと感じている";
  return "みんなの意見が割れているので、もう少し見たい";
}

function questionReasonForTarget(
  game: NpcQuestionContext,
  npc: Player,
  target: Player,
  insight: NpcInsight | null,
): string {
  if (insight?.suspectId === target.id) return insight.reason;

  const blackClaim = [...game.npcClaims]
    .reverse()
    .find(
      (claim) =>
        claim.claimedRole === "占い師" &&
        claim.targetId === target.id &&
        claim.result === "人狼" &&
        latestSeerResults(game.npcClaims, claim.speakerId).get(target.id) ===
          "人狼" &&
        !logicallyDisprovedSeerIds(game).has(claim.speakerId),
    );
  if (blackClaim) {
    const hasConflictingWhite = game.npcClaims.some(
      (claim) =>
        claim.claimedRole === "占い師" &&
        claim.speakerId !== blackClaim.speakerId &&
        latestSeerResults(game.npcClaims, claim.speakerId).get(target.id) ===
          "人間",
    );
    return hasConflictingWhite
      ? "占い判定は割れているが、人狼判定も判断材料にしている"
      : "占い師COから人狼判定が出ている";
  }

  const opinionCount = [...game.humanSuspicions.entries()].filter(
    ([speakerId, argument]) =>
      argument.targetId === target.id &&
      argument.reason !== "intuition" &&
      game.players.some((player) => player.id === speakerId && player.alive) &&
      isHumanArgumentSupported(game, argument),
  ).length;
  if (opinionCount > 0) return `疑う意見が${opinionCount}人から出ている`;

  const previousVotes = latestVoteRound(game.voteHistory, game.day - 1);
  const voteCount = previousVotes?.ballots.filter(
    (ballot) => ballot.targetId === target.id,
  ).length;
  if (voteCount && voteCount >= 2)
    return `昨日の投票で${voteCount}票集まっていた`;

  const claimedRoles = game.npcClaims
    .filter((claim) => claim.speakerId === target.id)
    .map((claim) => claim.claimedRole);
  const concern = claimConcernForPlayer(game, target.id);
  if (concern === "over-capacity")
    return `${claimedRoles[0]}COが配役人数を超えている`;
  if (concern === "result-conflict") return "同じ相手への占い判定が割れている";

  return genericQuestionReason(npc.npcPersonality ?? "慎重");
}

export function npcSuspicionReason(
  game: NpcQuestionContext,
  npc: Player,
  target: Player,
): string {
  const insight = findNpcInsight(
    game.npcClaims,
    game.voteHistory,
    npc.id,
    new Set(
      game.players.filter((player) => player.alive).map((player) => player.id),
    ),
  );
  return questionReasonForTarget(game, npc, target, insight);
}

export function chooseNpcQuestionAnswer(
  game: NpcQuestionContext,
  npc: Player,
): NpcQuestionAnswer | null {
  let candidates = game.players.filter(
    (player) =>
      player.alive &&
      player.id !== npc.id &&
      !(npc.role === "共有者" && player.role === "共有者"),
  );
  if (
    isActualWolfRole(npc.role) ||
    npc.role === "狂信者" ||
    npc.role === "妖術師" ||
    npc.role === "分断者"
  ) {
    const nonWolves = candidates.filter(
      (player) => !isActualWolfRole(player.role),
    );
    if (nonWolves.length > 0) candidates = nonWolves;
  }
  if (candidates.length === 0) return null;

  const ownSeerClaims = game.npcClaims.filter(
    (claim) => claim.speakerId === npc.id && claim.claimedRole === "占い師",
  );
  const ownBlackClaim = [...ownSeerClaims]
    .reverse()
    .find(
      (claim) =>
        claim.result === "人狼" &&
        candidates.some((candidate) => candidate.id === claim.targetId),
    );
  if (ownBlackClaim) {
    return {
      targetId: ownBlackClaim.targetId,
      reason: "自分の占い師COで人狼判定を出している",
    };
  }

  const ownWhiteTargetIds = new Set(
    ownSeerClaims
      .filter((claim) => claim.result === "人間")
      .map((claim) => claim.targetId),
  );
  candidates = candidates.filter(
    (candidate) => !ownWhiteTargetIds.has(candidate.id),
  );
  if (candidates.length === 0) {
    return {
      reason: "自分の占い師COでは、生存者を人間と判定している",
    };
  }

  // 質問だけ別の推理をせず、投票と同じ公開情報・個別記憶を使う。
  // 最終投票には既存の迷いが残るため、回答は投票の確約ではない。
  const scores = npcDecisionSuspicion(game, npc);
  const aliveIds = new Set(
    game.players.filter((player) => player.alive).map((player) => player.id),
  );
  const insight = findNpcInsight(
    game.npcClaims,
    game.voteHistory,
    npc.id,
    aliveIds,
  );
  const highestScore = Math.max(
    ...candidates.map((candidate) => scores.get(candidate.id) ?? 0),
  );
  const topCandidates = candidates.filter(
    (candidate) => (scores.get(candidate.id) ?? 0) === highestScore,
  );
  const target =
    topCandidates[stableCandidateIndex(npc.id, game.day, topCandidates.length)];
  return {
    targetId: target.id,
    reason: questionReasonForTarget(game, npc, target, insight),
  };
}

export function npcOpinionLine(
  personality: NpcPersonality,
  targetName: string,
  reason?: string,
): string {
  const detail = reason ? `。${reason}` : "";
  if (personality === "慎重") {
    return `まだ断定はしないけど、**${targetName}** が気になる${detail}。`;
  }
  if (personality === "直感") {
    return `今は **${targetName}** を疑ってる${detail}。`;
  }
  if (personality === "追及") {
    return `**${targetName}**、説明してほしい${detail}。`;
  }
  return `みんなの動きを見ると、**${targetName}** が気になる${detail}。`;
}
