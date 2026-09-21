import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { isOwner } from "./access";
import { analyticsAppVersion } from "./analytics";
import {
  buildLatestReleaseAnalytics,
  type GameplayAnalyticsSummary,
  type LatestReleaseAnalytics,
} from "./match-analytics";
import type { Winner } from "./types";

const REQUEST_TIMEOUT_MS = 5000;
const REPORT_DAYS = 7;
const QUERY_PAGE_SIZE = 1000;
const SESSION_ID_CHUNK_SIZE = 100;

type NumericValue = number | string | null | undefined;

export interface DailyAnalyticsRow {
  day_jst: string;
  started?: NumericValue;
  completed?: NumericValue;
  abandoned?: NumericValue;
  started_chains?: NumericValue;
  solo_starts?: NumericValue;
  multiplayer_starts?: NumericValue;
  average_matches_per_chain?: NumericValue;
  first_to_second_match_rate_percent?: NumericValue;
  average_completed_seconds?: NumericValue;
  abandoned_lobby?: NumericValue;
  abandoned_role_setup?: NumericValue;
  abandoned_discussion?: NumericValue;
  abandoned_voting?: NumericValue;
  abandoned_night?: NumericValue;
  feedback_again?: NumericValue;
  feedback_neutral?: NumericValue;
  feedback_issue?: NumericValue;
  reason_npc?: NumericValue;
  reason_tempo?: NumericValue;
  reason_controls?: NumericValue;
  reason_roles?: NumericValue;
  reason_bug?: NumericValue;
  reason_other?: NumericValue;
}

export interface AbandonAnalyticsRow {
  day_jst: string;
  abandoned?: NumericValue;
  answered?: NumericValue;
  reroll_role?: NumericValue;
  testing_config?: NumericValue;
  controls?: NumericValue;
  too_long?: NumericValue;
  other?: NumericValue;
}

export interface VersionAnalyticsRow {
  app_version?: string | null;
  started_at?: string | null;
}

export interface PlayerSessionRow extends VersionAnalyticsRow {
  id: string;
  opened_at?: string | null;
  guild_id?: string | null;
  human_count?: NumericValue;
  status?: string | null;
  winner?: Winner | null;
  role_config?: Record<string, number> | null;
  gameplay_summary?: GameplayAnalyticsSummary | null;
}

export interface ParticipantAnalyticsRow {
  session_id: string;
  participant_hash: string;
}

export interface RetentionCohortRow {
  cohort_day_jst: string;
  new_players?: NumericValue;
  returned_day_1?: NumericValue;
  returned_day_7?: NumericValue;
}

export interface GuildFunnelRow {
  guild_hash: string;
  installed_at?: string | null;
  onboarding_sent_at?: string | null;
  quick_start_clicked_at?: string | null;
  first_lobby_at?: string | null;
  first_started_at?: string | null;
  first_completed_at?: string | null;
  removed_at?: string | null;
}

export interface AnalyticsRange {
  previousStart: string;
  previousEnd: string;
  currentStart: string;
  currentEnd: string;
  currentEndExclusive: string;
}

export interface AnalyticsPeriodTotals {
  started: number;
  completed: number;
  abandoned: number;
  soloStarts: number;
  multiplayerStarts: number;
  completionRate: number | null;
  averageMatchesPerChain: number | null;
  secondMatchRate: number | null;
  averageCompletedSeconds: number | null;
  abandonedLobby: number;
  abandonedRoleSetup: number;
  abandonedDiscussion: number;
  abandonedVoting: number;
  abandonedNight: number;
  feedbackAgain: number;
  feedbackNeutral: number;
  feedbackIssue: number;
  reasonNpc: number;
  reasonTempo: number;
  reasonControls: number;
  reasonRoles: number;
  reasonBug: number;
  reasonOther: number;
}

export interface PlayerAnalyticsSummary {
  active: number;
  newPlayers: number;
  returning: number;
  previousActive: number;
}

export interface RetentionAnalyticsSummary {
  day1Eligible: number;
  day1Returned: number;
  day7Eligible: number;
  day7Returned: number;
}

export interface SessionAnalyticsSummary {
  activeGuilds: number;
  previousActiveGuilds: number;
  activeGuildCountComplete?: boolean;
  previousGuildCountComplete?: boolean;
  onePlayerStarts: number;
  twoPlayerStarts: number;
  threePlusPlayerStarts: number;
  unfinished: number;
}

export interface GuildFunnelPeriodSummary {
  installs: number;
  onboardingSent: number;
  quickStarts: number;
  lobbies: number;
  started: number;
  completed: number;
  removed: number;
}

export interface GuildFunnelSummary {
  enabled: boolean;
  extended: boolean;
  current: GuildFunnelPeriodSummary;
  previous: GuildFunnelPeriodSummary;
}

export interface AdminAnalyticsReport {
  range: AnalyticsRange;
  current: AnalyticsPeriodTotals;
  previous: AnalyticsPeriodTotals;
  abandonReasons: {
    abandoned: number;
    answered: number;
    rerollRole: number;
    testingConfig: number;
    controls: number;
    tooLong: number;
    other: number;
  };
  players: PlayerAnalyticsSummary;
  retention: RetentionAnalyticsSummary;
  sessions: SessionAnalyticsSummary;
  guildFunnel: GuildFunnelSummary;
  versions: Array<{ version: string; starts: number }>;
  latestRelease: LatestReleaseAnalytics;
}

export function buildRetentionAnalyticsSummary(
  cohorts: RetentionCohortRow[],
  range: AnalyticsRange,
): RetentionAnalyticsSummary {
  const summary: RetentionAnalyticsSummary = {
    day1Eligible: 0,
    day1Returned: 0,
    day7Eligible: 0,
    day7Returned: 0,
  };
  for (const row of cohorts) {
    const newPlayers = numberValue(row.new_players);
    const day1ObservedInPeriod = inRange(
      shiftJstDate(row.cohort_day_jst, 1),
      range.currentStart,
      range.currentEnd,
    );
    const day7ObservedInPeriod = inRange(
      shiftJstDate(row.cohort_day_jst, 7),
      range.currentStart,
      range.currentEnd,
    );
    if (
      day1ObservedInPeriod &&
      row.returned_day_1 !== null &&
      row.returned_day_1 !== undefined
    ) {
      summary.day1Eligible += newPlayers;
      summary.day1Returned += numberValue(row.returned_day_1);
    }
    if (
      day7ObservedInPeriod &&
      row.returned_day_7 !== null &&
      row.returned_day_7 !== undefined
    ) {
      summary.day7Eligible += newPlayers;
      summary.day7Returned += numberValue(row.returned_day_7);
    }
  }
  return summary;
}

export type AdminAnalyticsResult =
  | { status: "found"; report: AdminAnalyticsReport }
  | { status: "disabled" }
  | { status: "failed" };

let cachedClient: SupabaseClient | null | undefined;
let warnedAboutMissingConfig = false;

const timedFetch: typeof fetch = async (input, init = {}) => {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  }
};

function adminAnalyticsClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_KEY?.trim();

  if (!url || !key) {
    if (!warnedAboutMissingConfig && process.env.NODE_ENV !== "test") {
      console.warn(
        "Admin analytics are disabled: SUPABASE_URL and a Supabase secret key are required.",
      );
      warnedAboutMissingConfig = true;
    }
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: timedFetch },
  });
  return cachedClient;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function numberValue(value: NumericValue): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jstDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftJstDate(dateKey: string, days: number): string {
  const shifted = new Date(`${dateKey}T00:00:00+09:00`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return jstDateKey(shifted);
}

export function analyticsRange(now = new Date()): AnalyticsRange {
  const currentEnd = jstDateKey(now);
  return {
    previousStart: shiftJstDate(currentEnd, -(REPORT_DAYS * 2 - 1)),
    previousEnd: shiftJstDate(currentEnd, -REPORT_DAYS),
    currentStart: shiftJstDate(currentEnd, -(REPORT_DAYS - 1)),
    currentEnd,
    currentEndExclusive: shiftJstDate(currentEnd, 1),
  };
}

function inRange(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

function weightedAverage(
  rows: DailyAnalyticsRow[],
  value: (row: DailyAnalyticsRow) => NumericValue,
  weight: (row: DailyAnalyticsRow) => NumericValue,
): number | null {
  let total = 0;
  let totalWeight = 0;
  for (const row of rows) {
    const rowWeight = numberValue(weight(row));
    const rowValue = Number(value(row));
    if (rowWeight <= 0 || !Number.isFinite(rowValue)) continue;
    total += rowValue * rowWeight;
    totalWeight += rowWeight;
  }
  return totalWeight ? total / totalWeight : null;
}

function periodTotals(rows: DailyAnalyticsRow[]): AnalyticsPeriodTotals {
  const sum = (value: (row: DailyAnalyticsRow) => NumericValue) =>
    rows.reduce((total, row) => total + numberValue(value(row)), 0);
  const started = sum((row) => row.started);
  const completed = sum((row) => row.completed);

  return {
    started,
    completed,
    abandoned: sum((row) => row.abandoned),
    soloStarts: sum((row) => row.solo_starts),
    multiplayerStarts: sum((row) => row.multiplayer_starts),
    completionRate: started ? (completed / started) * 100 : null,
    averageMatchesPerChain: weightedAverage(
      rows,
      (row) => row.average_matches_per_chain,
      (row) => row.started_chains,
    ),
    secondMatchRate: weightedAverage(
      rows,
      (row) => row.first_to_second_match_rate_percent,
      (row) => row.started_chains,
    ),
    averageCompletedSeconds: weightedAverage(
      rows,
      (row) => row.average_completed_seconds,
      (row) => row.completed,
    ),
    abandonedLobby: sum((row) => row.abandoned_lobby),
    abandonedRoleSetup: sum((row) => row.abandoned_role_setup),
    abandonedDiscussion: sum((row) => row.abandoned_discussion),
    abandonedVoting: sum((row) => row.abandoned_voting),
    abandonedNight: sum((row) => row.abandoned_night),
    feedbackAgain: sum((row) => row.feedback_again),
    feedbackNeutral: sum((row) => row.feedback_neutral),
    feedbackIssue: sum((row) => row.feedback_issue),
    reasonNpc: sum((row) => row.reason_npc),
    reasonTempo: sum((row) => row.reason_tempo),
    reasonControls: sum((row) => row.reason_controls),
    reasonRoles: sum((row) => row.reason_roles),
    reasonBug: sum((row) => row.reason_bug),
    reasonOther: sum((row) => row.reason_other),
  };
}

export function buildPlayerAnalyticsSummary(
  sessions: PlayerSessionRow[],
  participants: ParticipantAnalyticsRow[],
  cohorts: RetentionCohortRow[],
  range: AnalyticsRange,
): PlayerAnalyticsSummary {
  const sessionPeriods = new Map<string, "current" | "previous">();
  for (const session of sessions) {
    const period = sessionPeriod(session, range);
    if (period) sessionPeriods.set(session.id, period);
  }

  const currentPlayers = new Set<string>();
  const previousPlayers = new Set<string>();
  for (const participant of participants) {
    const hash = participant.participant_hash.trim();
    if (!hash) continue;
    const period = sessionPeriods.get(participant.session_id);
    if (period === "current") currentPlayers.add(hash);
    else if (period === "previous") previousPlayers.add(hash);
  }

  const cohortNewPlayers = cohorts
    .filter((row) =>
      inRange(row.cohort_day_jst, range.currentStart, range.currentEnd),
    )
    .reduce((total, row) => total + numberValue(row.new_players), 0);
  const newPlayers = Math.min(currentPlayers.size, cohortNewPlayers);
  return {
    active: currentPlayers.size,
    newPlayers,
    returning: currentPlayers.size - newPlayers,
    previousActive: previousPlayers.size,
  };
}

function sessionPeriod(
  session: PlayerSessionRow,
  range: AnalyticsRange,
): "current" | "previous" | undefined {
  const timestamp = session.opened_at ?? session.started_at;
  if (!timestamp) return undefined;
  const openedAt = new Date(timestamp);
  if (!Number.isFinite(openedAt.getTime())) return undefined;
  const day = jstDateKey(openedAt);
  if (inRange(day, range.currentStart, range.currentEnd)) return "current";
  if (inRange(day, range.previousStart, range.previousEnd)) return "previous";
  return undefined;
}

export function buildSessionAnalyticsSummary(
  sessions: PlayerSessionRow[],
  range: AnalyticsRange,
): SessionAnalyticsSummary {
  const currentGuilds = new Set<string>();
  const previousGuilds = new Set<string>();
  let onePlayerStarts = 0;
  let twoPlayerStarts = 0;
  let threePlusPlayerStarts = 0;
  let unfinished = 0;

  for (const session of sessions) {
    const period = sessionPeriod(session, range);
    if (!period) continue;
    const guildId = session.guild_id?.trim();
    if (guildId && /^g1:[0-9a-f]{64}$/.test(guildId)) {
      if (period === "current") currentGuilds.add(guildId);
      else previousGuilds.add(guildId);
    }
    if (period !== "current") continue;

    const humanCount = numberValue(session.human_count);
    if (humanCount === 1) onePlayerStarts += 1;
    else if (humanCount === 2) twoPlayerStarts += 1;
    else if (humanCount >= 3) threePlusPlayerStarts += 1;
    if (session.status === "started") unfinished += 1;
  }

  return {
    activeGuilds: currentGuilds.size,
    previousActiveGuilds: previousGuilds.size,
    activeGuildCountComplete: true,
    previousGuildCountComplete: true,
    onePlayerStarts,
    twoPlayerStarts,
    threePlusPlayerStarts,
    unfinished,
  };
}

function funnelPeriod(
  timestamp: string | null | undefined,
  range: AnalyticsRange,
): "current" | "previous" | undefined {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  const day = jstDateKey(date);
  if (inRange(day, range.currentStart, range.currentEnd)) return "current";
  if (inRange(day, range.previousStart, range.previousEnd)) return "previous";
  return undefined;
}

function emptyGuildFunnelPeriod(): GuildFunnelPeriodSummary {
  return {
    installs: 0,
    onboardingSent: 0,
    quickStarts: 0,
    lobbies: 0,
    started: 0,
    completed: 0,
    removed: 0,
  };
}

export function buildGuildFunnelSummary(
  rows: GuildFunnelRow[],
  range: AnalyticsRange,
  enabled = true,
  extended = enabled,
): GuildFunnelSummary {
  const summary: GuildFunnelSummary = {
    enabled,
    extended,
    current: emptyGuildFunnelPeriod(),
    previous: emptyGuildFunnelPeriod(),
  };
  if (!enabled) return summary;

  for (const row of rows) {
    const installedPeriod = funnelPeriod(row.installed_at, range);
    if (installedPeriod) {
      const period = summary[installedPeriod];
      const installedAt = new Date(row.installed_at as string).getTime();
      period.installs += 1;
      const reachedAfterInstall = (timestamp?: string | null) => {
        if (!timestamp) return false;
        const reachedAt = new Date(timestamp).getTime();
        return Number.isFinite(reachedAt) && reachedAt >= installedAt;
      };
      if (reachedAfterInstall(row.onboarding_sent_at))
        period.onboardingSent += 1;
      if (reachedAfterInstall(row.quick_start_clicked_at))
        period.quickStarts += 1;
      if (reachedAfterInstall(row.first_lobby_at)) period.lobbies += 1;
      const startedAt = reachedAfterInstall(row.first_started_at)
        ? new Date(row.first_started_at as string).getTime()
        : undefined;
      if (startedAt !== undefined) period.started += 1;
      const completedAt = reachedAfterInstall(row.first_completed_at)
        ? new Date(row.first_completed_at as string).getTime()
        : undefined;
      if (
        startedAt !== undefined &&
        completedAt !== undefined &&
        completedAt >= startedAt
      )
        period.completed += 1;
    }

    const removedPeriod = funnelPeriod(row.removed_at, range);
    if (removedPeriod) summary[removedPeriod].removed += 1;
  }
  return summary;
}

export function buildAdminAnalyticsReport(
  dailyRows: DailyAnalyticsRow[],
  abandonRows: AbandonAnalyticsRow[],
  versionRows: PlayerSessionRow[],
  players: PlayerAnalyticsSummary = {
    active: 0,
    newPlayers: 0,
    returning: 0,
    previousActive: 0,
  },
  sessions: SessionAnalyticsSummary = {
    activeGuilds: 0,
    previousActiveGuilds: 0,
    activeGuildCountComplete: true,
    previousGuildCountComplete: true,
    onePlayerStarts: 0,
    twoPlayerStarts: 0,
    threePlusPlayerStarts: 0,
    unfinished: 0,
  },
  now = new Date(),
  guildFunnel: GuildFunnelSummary = buildGuildFunnelSummary(
    [],
    analyticsRange(now),
    false,
    false,
  ),
  retention: RetentionAnalyticsSummary = buildRetentionAnalyticsSummary(
    [],
    analyticsRange(now),
  ),
  currentVersion?: string,
): AdminAnalyticsReport {
  const range = analyticsRange(now);
  const currentRows = dailyRows.filter((row) =>
    inRange(row.day_jst, range.currentStart, range.currentEnd),
  );
  const previousRows = dailyRows.filter((row) =>
    inRange(row.day_jst, range.previousStart, range.previousEnd),
  );
  const currentAbandons = abandonRows.filter((row) =>
    inRange(row.day_jst, range.currentStart, range.currentEnd),
  );
  const sumAbandon = (value: (row: AbandonAnalyticsRow) => NumericValue) =>
    currentAbandons.reduce((total, row) => total + numberValue(value(row)), 0);
  const versionCounts = new Map<string, number>();
  for (const row of versionRows) {
    const version = row.app_version?.trim() || "unknown";
    versionCounts.set(version, (versionCounts.get(version) ?? 0) + 1);
  }

  return {
    range,
    current: periodTotals(currentRows),
    previous: periodTotals(previousRows),
    abandonReasons: {
      abandoned: sumAbandon((row) => row.abandoned),
      answered: sumAbandon((row) => row.answered),
      rerollRole: sumAbandon((row) => row.reroll_role),
      testingConfig: sumAbandon((row) => row.testing_config),
      controls: sumAbandon((row) => row.controls),
      tooLong: sumAbandon((row) => row.too_long),
      other: sumAbandon((row) => row.other),
    },
    players,
    retention,
    sessions,
    guildFunnel,
    latestRelease: buildLatestReleaseAnalytics(
      versionRows,
      currentVersion,
    ),
    versions: [...versionCounts]
      .map(([version, starts]) => ({ version, starts }))
      .sort((left, right) => right.starts - left.starts),
  };
}

async function loadGuildFunnelRowsByColumn(
  client: SupabaseClient,
  column: "installed_at" | "removed_at",
  startIso: string,
  endIso: string,
  columns: string,
): Promise<GuildFunnelRow[]> {
  const rows: GuildFunnelRow[] = [];
  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const { data, error } = await client
      .from("tomatobot_guild_funnel")
      .select(columns)
      .gte(column, startIso)
      .lt(column, endIso)
      .order(column, { ascending: true })
      .order("guild_hash", { ascending: true })
      .range(offset, offset + QUERY_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as GuildFunnelRow[];
    rows.push(...page);
    if (page.length < QUERY_PAGE_SIZE) return rows;
  }
}

async function loadGuildFunnelRows(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<{ enabled: boolean; extended: boolean; rows: GuildFunnelRow[] }> {
  const extendedColumns =
    "guild_hash,installed_at,onboarding_sent_at,quick_start_clicked_at,first_lobby_at,first_started_at,first_completed_at,removed_at";
  const legacyColumns =
    "guild_hash,installed_at,onboarding_sent_at,first_lobby_at,first_started_at,removed_at";
  const loadColumns = async (columns: string) => {
    const [installs, removals] = await Promise.all([
      loadGuildFunnelRowsByColumn(
        client,
        "installed_at",
        startIso,
        endIso,
        columns,
      ),
      loadGuildFunnelRowsByColumn(
        client,
        "removed_at",
        startIso,
        endIso,
        columns,
      ),
    ]);
    const unique = new Map<string, GuildFunnelRow>();
    for (const row of [...installs, ...removals])
      unique.set(row.guild_hash, row);
    return [...unique.values()];
  };

  try {
    return {
      enabled: true,
      extended: true,
      rows: await loadColumns(extendedColumns),
    };
  } catch (extendedError) {
    try {
      const rows = await loadColumns(legacyColumns);
      console.warn(
        `Extended guild funnel analytics unavailable; using legacy columns: ${errorMessage(extendedError)}`,
      );
      return { enabled: true, extended: false, rows };
    } catch (error) {
      console.warn(`Guild funnel analytics unavailable: ${errorMessage(error)}`);
      return { enabled: false, extended: false, rows: [] };
    }
  }
}

async function loadPlayerSessionRows(
  client: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<PlayerSessionRow[]> {
  const extendedColumns =
    "id,opened_at,started_at,app_version,guild_id,human_count,status,winner,role_config,gameplay_summary";
  const legacyColumns =
    "id,opened_at,started_at,app_version,guild_id,human_count,status,winner,role_config";
  const loadColumns = async (columns: string): Promise<PlayerSessionRow[]> => {
    const rows: PlayerSessionRow[] = [];
    for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
      const { data, error } = await client
        .from("tomatobot_play_sessions")
        .select(columns)
        .not("started_at", "is", null)
        .gte("opened_at", startIso)
        .lt("opened_at", endIso)
        .order("opened_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + QUERY_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as unknown as PlayerSessionRow[];
      rows.push(...page);
      if (page.length < QUERY_PAGE_SIZE) return rows;
    }
  };

  try {
    return await loadColumns(extendedColumns);
  } catch (extendedError) {
    console.warn(
      `Gameplay analytics unavailable; using legacy session columns: ${errorMessage(extendedError)}`,
    );
    return loadColumns(legacyColumns);
  }
}

async function loadParticipantRows(
  client: SupabaseClient,
  sessionIds: string[],
): Promise<ParticipantAnalyticsRow[]> {
  // The stored identifiers are irreversible HMAC hashes. Only aggregate counts
  // leave this module; Discord IDs and display names are never queried here.
  const rows: ParticipantAnalyticsRow[] = [];
  for (
    let chunkStart = 0;
    chunkStart < sessionIds.length;
    chunkStart += SESSION_ID_CHUNK_SIZE
  ) {
    const chunk = sessionIds.slice(
      chunkStart,
      chunkStart + SESSION_ID_CHUNK_SIZE,
    );
    for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
      const { data, error } = await client
        .from("tomatobot_play_participants")
        .select("session_id,participant_hash")
        .in("session_id", chunk)
        .order("session_id", { ascending: true })
        .order("participant_hash", { ascending: true })
        .range(offset, offset + QUERY_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as ParticipantAnalyticsRow[];
      rows.push(...page);
      if (page.length < QUERY_PAGE_SIZE) break;
    }
  }
  return rows;
}

export async function getAdminAnalytics(
  now = new Date(),
): Promise<AdminAnalyticsResult> {
  try {
    const client = adminAnalyticsClient();
    if (!client) return { status: "disabled" };
    const range = analyticsRange(now);
    const previousStartIso = new Date(
      `${range.previousStart}T00:00:00+09:00`,
    ).toISOString();
    const currentEndIso = new Date(
      `${range.currentEndExclusive}T00:00:00+09:00`,
    ).toISOString();

    const [daily, abandons, sessions, cohorts, guildFunnelRows] =
      await Promise.all([
        client
          .from("tomatobot_play_daily_summary_v2")
          .select("*")
          .gte("day_jst", range.previousStart)
          .lte("day_jst", range.currentEnd)
          .order("day_jst", { ascending: true }),
        client
          .from("tomatobot_abandon_reason_summary")
          .select("*")
          .gte("day_jst", range.currentStart)
          .lte("day_jst", range.currentEnd),
        loadPlayerSessionRows(client, previousStartIso, currentEndIso),
        client
          .from("tomatobot_player_retention_cohorts")
          .select(
            "cohort_day_jst,new_players,returned_day_1,returned_day_7",
          )
          .gte("cohort_day_jst", range.previousStart)
          .lte("cohort_day_jst", range.currentEnd),
        loadGuildFunnelRows(client, previousStartIso, currentEndIso),
      ]);

    if (daily.error) throw daily.error;
    if (abandons.error) throw abandons.error;
    if (cohorts.error) throw cohorts.error;

    const participants = await loadParticipantRows(
      client,
      sessions.map((session) => session.id),
    );
    const cohortRows = (cohorts.data ?? []) as RetentionCohortRow[];
    const players = buildPlayerAnalyticsSummary(
      sessions,
      participants,
      cohortRows,
      range,
    );
    const retention = buildRetentionAnalyticsSummary(cohortRows, range);
    const sessionSummary = buildSessionAnalyticsSummary(sessions, range);
    const guildFunnel = buildGuildFunnelSummary(
      guildFunnelRows.rows,
      range,
      guildFunnelRows.enabled,
      guildFunnelRows.extended,
    );
    const versions = sessions.filter((session) => {
      return sessionPeriod(session, range) === "current";
    });

    return {
      status: "found",
      report: buildAdminAnalyticsReport(
        (daily.data ?? []) as DailyAnalyticsRow[],
        (abandons.data ?? []) as AbandonAnalyticsRow[],
        versions,
        players,
        sessionSummary,
        now,
        guildFunnel,
        retention,
        analyticsAppVersion(),
      ),
    };
  } catch (error) {
    console.error(`Admin analytics read failed: ${errorMessage(error)}`);
    return { status: "failed" };
  }
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function rate(part: number, whole: number): number | null {
  return whole ? (part / whole) * 100 : null;
}

function retentionFraction(returned: number, eligible: number): string {
  return eligible
    ? `${returned}/${eligible}（${percent(rate(returned, eligible))}）`
    : "—";
}

function decimal(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes ? `${minutes}分${remainder}秒` : `${remainder}秒`;
}

function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function signed(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(suffix ? 1 : 0)}${suffix}`;
}

function signedCount(value: number): string {
  if (value === 0) return "±0";
  return `${value > 0 ? "+" : ""}${value}`;
}

function versionLabel(version: string): string {
  if (version === "unknown") return "不明";
  const releaseWithCommit = /^(\d+\.\d+\.\d+)\+([0-9a-f]{7,})$/i.exec(version);
  if (releaseWithCommit)
    return `${releaseWithCommit[1]}（${releaseWithCommit[2].slice(0, 7)}）`;
  if (/^[0-9a-f]{7,}$/i.test(version)) return version.slice(0, 7);
  return version.length > 24 ? `${version.slice(0, 23)}…` : version;
}

const ACTION_LABELS: Record<string, string> = {
  kill: "襲撃",
  guard: "護衛",
  seer: "占い",
  flee: "逃亡",
  assassinate: "暗殺",
  sorcery: "妖術",
  divide: "分断",
  compass: "方位",
  cupid: "恋人指定",
  devotee: "純愛指定",
  thief: "怪盗",
};

function latestReleaseText(latest: LatestReleaseAnalytics): string {
  if (!latest.version) return "バージョンを特定できません。";
  const lines = [
    `対象 **${versionLabel(latest.version)}**｜開始 **${latest.started}**｜完走 **${latest.completed}**`,
  ];
  if (latest.completed === 0) {
    lines.push("この更新後の完走データはまだありません。勝率調整は保留します。");
    return lines.join("\n");
  }
  lines.push(
    `村 **${latest.wins.villager}**｜狼 **${latest.wins.wolf}**｜狐 **${latest.wins.fox}**｜恋 **${latest.wins.lovers}**｜てるてる **${latest.wins.teruteru}**`,
  );
  if (latest.telemetryMatches > 0) {
    lines.push(
      `匿名計測 **${latest.telemetryMatches}戦**｜CO **${latest.claims.total}**（人 ${latest.claims.human}・NPC ${latest.claims.npc}）｜撤回 **${latest.retractions}**`,
    );
    const actions = Object.entries(latest.nightActions)
      .filter(([, count]) => count.total > 0)
      .sort((left, right) => right[1].total - left[1].total)
      .slice(0, 6)
      .map(
        ([action, count]) =>
          `${ACTION_LABELS[action] ?? action} ${count.total}（NPC ${count.npc}）`,
      );
    if (actions.length) lines.push(`夜能力｜${actions.join("｜")}`);
  } else {
    lines.push("CO・能力の匿名計測は移行SQL適用後の試合から始まります。");
  }
  if (latest.completed < 30)
    lines.push("※ 30完走未満のため、勝率による強弱調整は保留");
  return lines.join("\n");
}

function comparisonLine(
  current: AnalyticsPeriodTotals,
  previous: AnalyticsPeriodTotals,
  players: PlayerAnalyticsSummary,
  sessions: SessionAnalyticsSummary,
): string {
  const playerComparison =
    players.active || players.previousActive
      ? `利用者 ${players.previousActive}→${players.active}（${signedCount(players.active - players.previousActive)}）`
      : "利用者 —";
  const guildComparison =
    sessions.activeGuilds || sessions.previousActiveGuilds
      ? `稼働サーバー ${sessions.previousActiveGuilds}→${sessions.activeGuilds}（${signedCount(sessions.activeGuilds - sessions.previousActiveGuilds)}）`
      : "稼働サーバー —";
  if (!previous.started)
    return `${playerComparison}｜${guildComparison}｜前週の試合データなし`;
  const completionDifference =
    current.completionRate === null || previous.completionRate === null
      ? null
      : current.completionRate - previous.completionRate;
  const secondMatchDifference =
    current.secondMatchRate === null || previous.secondMatchRate === null
      ? null
      : current.secondMatchRate - previous.secondMatchRate;
  return [
    `開始 ${signed(current.started - previous.started)}`,
    `完走率 ${completionDifference === null ? "—" : signed(completionDifference, "pt")}`,
    `連戦率 ${secondMatchDifference === null ? "—" : signed(secondMatchDifference, "pt")}`,
    playerComparison,
    guildComparison,
  ].join("｜");
}

export function adminAnalyticsEmbed(
  report: AdminAnalyticsReport,
): EmbedBuilder {
  const current = report.current;
  const reasons = report.abandonReasons;
  const beforeStartAbandons =
    current.abandonedLobby + current.abandonedRoleSetup;
  const inGameAbandons =
    current.abandonedDiscussion +
    current.abandonedVoting +
    current.abandonedNight;
  const unknownAbandons = Math.max(
    0,
    current.abandoned - beforeStartAbandons - inGameAbandons,
  );
  const playerText =
    report.players.active || !current.started
      ? `利用者 **${report.players.active}人**｜新規 **${report.players.newPlayers}**｜再訪 **${report.players.returning}**`
      : "利用者 **—**｜匿名集計データなし";
  const retentionText = `翌日再訪 **${retentionFraction(report.retention.day1Returned, report.retention.day1Eligible)}**｜7日後再訪 **${retentionFraction(report.retention.day7Returned, report.retention.day7Eligible)}**`;
  const activeGuildText = String(report.sessions.activeGuilds);
  const versionText = report.versions.length
    ? report.versions
        .slice(0, 4)
        .map((item) => `${versionLabel(item.version)}｜${item.starts}試合`)
        .join("\n")
    : "開始データなし";
  const funnel = report.guildFunnel.current;
  const funnelText = report.guildFunnel.enabled
    ? report.guildFunnel.extended
      ? [
          `新規導入 **${funnel.installs}**｜案内成功 **${funnel.onboardingSent}**`,
          `案内クリック **${funnel.quickStarts}**（導入比 ${percent(rate(funnel.quickStarts, funnel.installs))}）｜募集作成 **${funnel.lobbies}**（導入比 ${percent(rate(funnel.lobbies, funnel.installs))}）`,
          `初戦開始 **${funnel.started}**（導入比 ${percent(rate(funnel.started, funnel.installs))}）｜初完走 **${funnel.completed}**（開始後 ${percent(rate(funnel.completed, funnel.started))}）`,
          `退出 **${funnel.removed}**｜前週 導入 ${report.guildFunnel.previous.installs}・初戦 ${report.guildFunnel.previous.started}・初完走 ${report.guildFunnel.previous.completed}`,
        ].join("\n")
      : [
          `新規導入 **${funnel.installs}**｜案内成功 **${funnel.onboardingSent}**`,
          `募集作成 **${funnel.lobbies}**（導入比 ${percent(rate(funnel.lobbies, funnel.installs))}）｜初戦開始 **${funnel.started}**（導入比 ${percent(rate(funnel.started, funnel.installs))}）`,
          `案内クリック **—**｜初完走 **—**（拡張SQL未適用）｜退出 **${funnel.removed}**`,
        ].join("\n")
    : "導入分析用のSQLが未適用です。ゲーム本体と従来の分析には影響しません。";

  return new EmbedBuilder()
    .setColor(0x7b83ff)
    .setTitle("📊 運営レポート｜直近7日")
    .setDescription(
      `**${shortDate(report.range.currentStart)}〜${shortDate(report.range.currentEnd)}（JST）**`,
    )
    .addFields(
      {
        name: "プレイ状況",
        value: [
          `開始 **${current.started}**｜完走 **${current.completed}**（${percent(current.completionRate)}）`,
          playerText,
          `稼働サーバー **${activeGuildText}**｜友達戦率 **${percent(rate(current.multiplayerStarts, current.started))}**`,
          `1人 **${report.sessions.onePlayerStarts}**｜2人 **${report.sessions.twoPlayerStarts}**｜3人以上 **${report.sessions.threePlusPlayerStarts}**`,
          `連戦率 **${percent(current.secondMatchRate)}**｜平均 **${decimal(current.averageMatchesPerChain)}戦**`,
          retentionText,
        ].join("\n"),
      },
      {
        name: "導入ファネル",
        value: funnelText,
      },
      {
        name: "テンポ・中断",
        value: [
          `平均試合時間 **${duration(current.averageCompletedSeconds)}**｜中断 **${current.abandoned}**｜未終了 **${report.sessions.unfinished}**`,
          `開始前 **${beforeStartAbandons}**｜試合中 **${inGameAbandons}**｜不明 **${unknownAbandons}**`,
          `ロビー ${current.abandonedLobby}｜配役 ${current.abandonedRoleSetup}｜議論 ${current.abandonedDiscussion}｜投票 ${current.abandonedVoting}｜夜 ${current.abandonedNight}`,
          `終了理由回答 ${reasons.answered}/${reasons.abandoned}｜役職引き直し ${reasons.rerollRole}｜テスト ${reasons.testingConfig}｜操作 ${reasons.controls}｜長い ${reasons.tooLong}｜その他 ${reasons.other}`,
        ].join("\n"),
      },
      {
        name: "気になる点",
        value: current.feedbackIssue
          ? [
              `報告 **${current.feedbackIssue}**`,
              `NPC ${current.reasonNpc}｜テンポ ${current.reasonTempo}｜操作 ${current.reasonControls}｜配役 ${current.reasonRoles}｜バグ ${current.reasonBug}｜その他 ${current.reasonOther}`,
            ].join("\n")
          : "報告なし",
      },
      {
        name: "最新版の実戦",
        value: latestReleaseText(report.latestRelease),
      },
      {
        name: "前週比",
        value: comparisonLine(
          current,
          report.previous,
          report.players,
          report.sessions,
        ),
      },
      {
        name: "Bot更新",
        value: versionText,
      },
    )
    .setFooter({
      text: "個人名・Discord ID・会話内容・個人ごとの役職・投票先は表示していません",
    });
}

export async function handleAdminAnalyticsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      content: "このコマンドは運営者専用です。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await getAdminAnalytics();
  if (result.status === "disabled") {
    await interaction.editReply(
      "分析機能は現在無効です。Supabaseの設定を確認してください。",
    );
    return;
  }
  if (result.status === "failed") {
    await interaction.editReply(
      "分析データを取得できませんでした。少し待ってから再実行してください。",
    );
    return;
  }

  await interaction.editReply({ embeds: [adminAnalyticsEmbed(result.report)] });
}
