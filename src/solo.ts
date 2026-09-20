import { buildRoles, isActualWolfRole } from "./roles";
import type { Player, RoleName } from "./types";

export const SOLO_PLAYER_COUNT = 7;

export function buildSoloRoles(playerCount: number): RoleName[] {
  if (playerCount < 4 || playerCount > 15) {
    throw new Error("プレイヤー数は4〜15人にしてください。");
  }

  const roles: RoleName[] = ["人狼", "占い師", "騎士"];
  if (playerCount >= 5) roles.push("霊能者");
  while (roles.length < playerCount) roles.push("村人");
  return roles;
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function assignGameRoles(
  players: Player[],
  random: () => number = Math.random,
  configuredRoles?: RoleName[],
): Map<string, RoleName> {
  const humans = players.filter((player) => !player.isNpc);
  const assignments = new Map<string, RoleName>();
  const rolePool =
    configuredRoles ??
    (humans.length === 1
      ? buildSoloRoles(players.length)
      : buildRoles(players.length));

  if (rolePool.length !== players.length) {
    throw new Error("役職数とプレイヤー数が一致していません。");
  }

  const roles = shuffled(rolePool, random);
  players.forEach((player, index) => assignments.set(player.id, roles[index]));
  return assignments;
}

export function chooseNpcVoteTarget(
  actor: Pick<Player, "id" | "role" | "npcPersonality">,
  candidates: Array<Pick<Player, "id" | "role">>,
  suspicion: ReadonlyMap<string, number>,
  random: () => number = Math.random,
): string {
  let valid = candidates.filter((candidate) => candidate.id !== actor.id);
  if (
    isActualWolfRole(actor.role) ||
    actor.role === "狂信者" ||
    actor.role === "妖術師" ||
    actor.role === "分断者"
  ) {
    const nonWolves = valid.filter(
      (candidate) => !isActualWolfRole(candidate.role),
    );
    if (nonWolves.length) valid = nonWolves;
  }
  if (!valid.length) throw new Error("NPCの投票対象がいません。");

  const randomness =
    actor.npcPersonality === "直感"
      ? 3
      : actor.npcPersonality === "慎重"
        ? 1
        : actor.npcPersonality === "追及"
          ? 1.3
          : 1.7;

  return valid
    .map((candidate) => ({
      id: candidate.id,
      score: (suspicion.get(candidate.id) ?? 0) + random() * randomness,
    }))
    .sort((left, right) => right.score - left.score)[0].id;
}

export function chooseNpcRevoteTarget(
  actor: Pick<Player, "id" | "role" | "npcPersonality">,
  candidates: Array<Pick<Player, "id" | "role">>,
  suspicion: ReadonlyMap<string, number>,
  previousTargetId: string | undefined,
  firstRoundCounts: ReadonlyMap<string, number>,
  random: () => number = Math.random,
): string {
  let valid = candidates.filter((candidate) => candidate.id !== actor.id);
  if (
    isActualWolfRole(actor.role) ||
    actor.role === "狂信者" ||
    actor.role === "妖術師" ||
    actor.role === "分断者"
  ) {
    const nonWolves = valid.filter(
      (candidate) => !isActualWolfRole(candidate.role),
    );
    if (nonWolves.length) valid = nonWolves;
  }
  if (!valid.length) throw new Error("NPCの再投票対象がいません。");

  const personality = actor.npcPersonality ?? "慎重";
  const randomness =
    personality === "直感"
      ? 2.4
      : personality === "慎重"
        ? 0.55
        : personality === "追及"
          ? 0.75
          : 0.8;

  return valid
    .map((candidate) => {
      const evidence = suspicion.get(candidate.id) ?? 0;
      const support = firstRoundCounts.get(candidate.id) ?? 0;
      const isPrevious = candidate.id === previousTargetId;
      const personalityScore =
        personality === "慎重"
          ? isPrevious
            ? 1.25
            : 0
          : personality === "直感"
            ? isPrevious
              ? -1.4
              : 0
            : personality === "追及"
              ? evidence * 0.25
              : support * 0.8;
      return {
        id: candidate.id,
        score: evidence + personalityScore + random() * randomness,
      };
    })
    .sort((left, right) => right.score - left.score)[0].id;
}
