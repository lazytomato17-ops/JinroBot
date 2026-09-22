import type { GameState, RoleName, Winner } from "./types";

export interface ActorCount {
  total: number;
  human: number;
  npc: number;
}

export interface GameplayAnalyticsSummary {
  schema: 1;
  claims: ActorCount & {
    retractions: number;
    byRole: Partial<Record<RoleName, ActorCount>>;
  };
  nightActions: Record<string, ActorCount>;
  voteRounds: number;
}

export interface MatchAnalyticsRow {
  app_version?: string | null;
  started_at?: string | null;
  status?: string | null;
  winner?: Winner | null;
  role_config?: Record<string, number> | null;
  gameplay_summary?: GameplayAnalyticsSummary | null;
}

export interface LatestReleaseAnalytics {
  version: string | null;
  started: number;
  completed: number;
  wins: Record<Winner, number>;
  telemetryMatches: number;
  claims: ActorCount;
  retractions: number;
  nightActions: Record<string, ActorCount>;
  configuredRoles: Partial<Record<RoleName, number>>;
}

const WINNERS: Winner[] = ["villager", "wolf", "fox", "lovers", "teruteru"];

function emptyActorCount(): ActorCount {
  return { total: 0, human: 0, npc: 0 };
}

function addActorCount(target: ActorCount, source: ActorCount): void {
  target.total += source.total;
  target.human += source.human;
  target.npc += source.npc;
}

function recordActor(
  counts: ActorCount,
  actorId: string,
  npcIds: ReadonlySet<string>,
): void {
  counts.total += 1;
  if (npcIds.has(actorId)) counts.npc += 1;
  else counts.human += 1;
}

/**
 * 試合全体の回数だけを保存する。プレイヤーID、名前、役職の割当、
 * 投票先、能力の対象、会話内容は含めない。
 */
export function buildGameplayAnalyticsSummary(
  game: Pick<
    GameState,
    "players" | "claimHistory" | "nightHistory" | "voteHistory"
  >,
): GameplayAnalyticsSummary {
  const npcIds = new Set(
    game.players.filter((player) => player.isNpc).map((player) => player.id),
  );
  const claims = {
    ...emptyActorCount(),
    retractions: 0,
    byRole: {} as Partial<Record<RoleName, ActorCount>>,
  };

  for (const event of game.claimHistory) {
    if (event.action === "retract") {
      claims.retractions += 1;
      continue;
    }
    recordActor(claims, event.speakerId, npcIds);
    const roleCount = claims.byRole[event.claimedRole] ?? emptyActorCount();
    recordActor(roleCount, event.speakerId, npcIds);
    claims.byRole[event.claimedRole] = roleCount;
  }

  const nightActions: Record<string, ActorCount> = {};
  const recordNightAction = (action: string, actorId: string) => {
    const count = nightActions[action] ?? emptyActorCount();
    recordActor(count, actorId, npcIds);
    nightActions[action] = count;
  };
  for (const night of game.nightHistory) {
    for (const choice of night.wolfChoices)
      recordNightAction("kill", choice.actorId);
    for (const choice of night.guardChoices)
      recordNightAction("guard", choice.actorId);
    for (const choice of night.seerChoices)
      recordNightAction("seer", choice.actorId);
    for (const choice of night.specialChoices ?? [])
      recordNightAction(choice.action, choice.actorId);
  }

  return {
    schema: 1,
    claims,
    nightActions,
    voteRounds: game.voteHistory.length,
  };
}

function newestVersion(rows: MatchAnalyticsRow[]): string | null {
  let newest: MatchAnalyticsRow | undefined;
  for (const row of rows) {
    if (!row.started_at || !row.app_version?.trim()) continue;
    if (!newest || row.started_at > (newest.started_at ?? "")) newest = row;
  }
  return newest?.app_version?.trim() || null;
}

export function buildLatestReleaseAnalytics(
  rows: MatchAnalyticsRow[],
  expectedVersion?: string,
): LatestReleaseAnalytics {
  const version = expectedVersion?.trim() || newestVersion(rows);
  const wins = Object.fromEntries(WINNERS.map((winner) => [winner, 0])) as Record<
    Winner,
    number
  >;
  const result: LatestReleaseAnalytics = {
    version,
    started: 0,
    completed: 0,
    wins,
    telemetryMatches: 0,
    claims: emptyActorCount(),
    retractions: 0,
    nightActions: {},
    configuredRoles: {},
  };
  if (!version) return result;

  for (const row of rows) {
    if (row.app_version?.trim() !== version || !row.started_at) continue;
    result.started += 1;
    if (row.status !== "completed" || !row.winner) continue;
    result.completed += 1;
    result.wins[row.winner] += 1;
    for (const [role, count] of Object.entries(row.role_config ?? {})) {
      if (!Number.isFinite(count) || count <= 0) continue;
      const roleName = role as RoleName;
      result.configuredRoles[roleName] =
        (result.configuredRoles[roleName] ?? 0) + count;
    }
    const telemetry = row.gameplay_summary;
    if (!telemetry || telemetry.schema !== 1) continue;
    result.telemetryMatches += 1;
    addActorCount(result.claims, telemetry.claims);
    result.retractions += telemetry.claims.retractions;
    for (const [action, count] of Object.entries(telemetry.nightActions)) {
      const target = result.nightActions[action] ?? emptyActorCount();
      addActorCount(target, count);
      result.nightActions[action] = target;
    }
  }
  return result;
}
