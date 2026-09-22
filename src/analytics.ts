import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import type { GameplayAnalyticsSummary } from "./match-analytics";
import type { Winner } from "./types";

const REQUEST_TIMEOUT_MS = 5000;

export type FeedbackRating = "again" | "neutral" | "issue";
export type FeedbackReason =
  | "npc"
  | "tempo"
  | "controls"
  | "roles"
  | "bug"
  | "other";
export type AbandonPhase =
  | "lobby"
  | "role_setup"
  | "discussion"
  | "voting"
  | "night"
  | "ended"
  | "unknown";
export type AbandonReason =
  | "reroll_role"
  | "testing_config"
  | "controls"
  | "too_long"
  | "other";
export type PlaySessionStatus =
  | "lobby"
  | "started"
  | "completed"
  | "cancelled"
  | "reset";
export type GuildFunnelEvent =
  | "installed"
  | "onboarding_sent"
  | "quick_start_clicked"
  | "lobby_opened"
  | "game_started"
  | "game_completed"
  | "removed";

export interface PlaySessionSnapshot {
  sessionId: string;
  sourceSessionId?: string;
  chainId?: string;
  appVersion?: string;
  guildId: string;
  channelId: string;
  targetPlayerCount: number;
  humanCount: number;
  npcCount: number;
  roleConfig: Record<string, number>;
}

export type AnalyticsResult = { status: "saved" | "disabled" | "failed" };
export type FeedbackResult =
  | { status: "saved"; outcome: "created" | "comment_appended" }
  | { status: "locked"; rating?: FeedbackRating }
  | { status: "disabled" | "failed" };

export interface SessionParticipantInput {
  userId: string;
  isHost?: boolean;
}

let cachedClient: SupabaseClient | null | undefined;
let warnedAboutMissingConfig = false;
let warnedAboutMissingHashSecret = false;

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

function analyticsClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_KEY?.trim();

  if (!url || !key) {
    if (!warnedAboutMissingConfig && process.env.NODE_ENV !== "test") {
      console.warn(
        "Play analytics are disabled: SUPABASE_URL and a Supabase secret key are required.",
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

function analyticsHashSecret(): string | null {
  const secret = process.env.TOMATOBOT_ANALYTICS_HMAC_SECRET?.trim();

  if (
    !secret &&
    !warnedAboutMissingHashSecret &&
    process.env.NODE_ENV !== "test"
  ) {
    console.warn(
      "Anonymous participant, feedback, and guild funnel analytics are disabled: set TOMATOBOT_ANALYTICS_HMAC_SECRET.",
    );
    warnedAboutMissingHashSecret = true;
  }
  return secret || null;
}

/**
 * Discord IDを外部から逆算しにくい、環境固有の安定した識別子へ変換する。
 * 生のIDはSupabaseへ送らない。秘密値を変更すると別ユーザーとして集計される。
 */
export function anonymizeAnalyticsUserId(userId: string): string | null {
  const secret = analyticsHashSecret();
  const normalized = userId.trim();
  if (!secret || !normalized) return null;
  return `v1:${createHmac("sha256", secret).update(normalized).digest("hex")}`;
}

/**
 * サーバーIDを参加者とは別の名前空間で匿名化する。
 * サーバー名や生のDiscordサーバーIDは導入ファネルへ保存しない。
 */
export function anonymizeAnalyticsGuildId(guildId: string): string | null {
  const secret = analyticsHashSecret();
  const normalized = guildId.trim();
  if (!secret || !normalized) return null;
  return `g1:${createHmac("sha256", secret)
    .update(`guild:${normalized}`)
    .digest("hex")}`;
}

export function anonymizeAnalyticsChannelId(
  guildId: string,
  channelId: string,
): string | null {
  const secret = analyticsHashSecret();
  const normalizedGuild = guildId.trim();
  const normalizedChannel = channelId.trim();
  if (!secret || !normalizedGuild || !normalizedChannel) return null;
  return `c1:${createHmac("sha256", secret)
    .update(`channel:${normalizedGuild}:${normalizedChannel}`)
    .digest("hex")}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function isMissingGameplaySummaryColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return (
    code === "PGRST204" && errorMessage(error).includes("gameplay_summary")
  );
}

async function save(
  action: string,
  operation: (client: SupabaseClient) => PromiseLike<{ error: unknown }>,
): Promise<AnalyticsResult> {
  try {
    const client = analyticsClient();
    if (!client) return { status: "disabled" };
    const { error } = await operation(client);
    if (error) throw error;
    return { status: "saved" };
  } catch (error) {
    console.error(`Play analytics ${action} failed: ${errorMessage(error)}`);
    return { status: "failed" };
  }
}

function sessionRow(
  input: PlaySessionSnapshot,
  status: PlaySessionStatus,
): Record<string, unknown> {
  const detectedVersion = analyticsAppVersion(input.appVersion);
  const anonymousGuild = anonymizeAnalyticsGuildId(input.guildId);
  const anonymousChannel = anonymizeAnalyticsChannelId(
    input.guildId,
    input.channelId,
  );
  return {
    id: input.sessionId,
    source_session_id: input.sourceSessionId ?? null,
    chain_id: input.chainId ?? input.sourceSessionId ?? input.sessionId,
    app_version: detectedVersion,
    guild_id: anonymousGuild ?? "anonymous-unavailable",
    channel_id: anonymousChannel ?? "anonymous-unavailable",
    status,
    target_player_count: input.targetPlayerCount,
    human_count: input.humanCount,
    npc_count: input.npcCount,
    role_config: input.roleConfig,
  };
}

export function analyticsAppVersion(explicit?: string): string {
  const explicitVersion = explicit?.trim();
  const releaseVersion =
    process.env.TOMATOBOT_VERSION?.trim() ||
    process.env.npm_package_version?.trim();
  const deployCommit = process.env.RENDER_GIT_COMMIT?.trim().slice(0, 12);
  const detectedVersion =
    explicitVersion ||
    [releaseVersion, deployCommit].filter(Boolean).join("+") ||
    "unknown";
  return detectedVersion.slice(0, 100);
}

export async function recordGuildFunnelEvent(
  guildId: string,
  event: GuildFunnelEvent,
  occurredAt = new Date(),
): Promise<AnalyticsResult> {
  const guildHash = anonymizeAnalyticsGuildId(guildId);
  if (!guildHash) return { status: "disabled" };
  const eventTime = Number.isFinite(occurredAt.getTime())
    ? occurredAt
    : new Date();
  return save(`guild funnel ${event}`, (client) =>
    client.rpc("tomatobot_record_guild_funnel_event", {
      p_guild_hash: guildHash,
      p_event: event,
      p_occurred_at: eventTime.toISOString(),
      p_app_version: analyticsAppVersion(),
    }),
  );
}

export async function recordLobbyOpened(
  input: PlaySessionSnapshot,
): Promise<AnalyticsResult> {
  const [sessionResult] = await Promise.all([
    save("lobby", (client) =>
      client
        .from("tomatobot_play_sessions")
        .upsert(sessionRow(input, "lobby"), { onConflict: "id" }),
    ),
    recordGuildFunnelEvent(input.guildId, "lobby_opened"),
  ]);
  return sessionResult;
}

export async function recordGameStarted(
  input: PlaySessionSnapshot & { startedAt: string },
): Promise<AnalyticsResult> {
  const [sessionResult] = await Promise.all([
    save("start", (client) =>
      client.from("tomatobot_play_sessions").upsert(
        {
          ...sessionRow(input, "started"),
          started_at: input.startedAt,
        },
        { onConflict: "id" },
      ),
    ),
    recordGuildFunnelEvent(
      input.guildId,
      "game_started",
      new Date(input.startedAt),
    ),
  ]);
  return sessionResult;
}

export async function recordGameCompleted(
  input: PlaySessionSnapshot & {
    winner: Winner;
    dayCount: number;
    durationSeconds: number;
    startedAt?: string;
    gameplaySummary?: GameplayAnalyticsSummary;
  },
): Promise<AnalyticsResult> {
  const completedAt = new Date();
  const [sessionResult] = await Promise.all([
    save("complete", async (client) => {
      const row = {
        ...sessionRow(input, "completed"),
        winner: input.winner,
        day_count: input.dayCount,
        duration_seconds: input.durationSeconds,
        started_at: input.startedAt,
        finished_at: completedAt.toISOString(),
        gameplay_summary: input.gameplaySummary,
      };
      const result = await client
        .from("tomatobot_play_sessions")
        .upsert(row, { onConflict: "id" });
      if (isMissingGameplaySummaryColumn(result.error)) {
        const { gameplay_summary: _summary, ...legacyRow } = row;
        console.warn(
          "Gameplay analytics migration is not applied; saving the legacy completion row.",
        );
        return client
          .from("tomatobot_play_sessions")
          .upsert(legacyRow, { onConflict: "id" });
      }
      return result;
    }),
    recordGuildFunnelEvent(input.guildId, "game_completed", completedAt),
  ]);
  return sessionResult;
}

export async function recordGameAbandoned(
  input: PlaySessionSnapshot & {
    status: "cancelled" | "reset";
    dayCount: number;
    durationSeconds?: number;
    startedAt?: string;
    abandonPhase?: AbandonPhase;
  },
): Promise<AnalyticsResult> {
  return save("abandon", (client) =>
    client.from("tomatobot_play_sessions").upsert(
      {
        ...sessionRow(input, input.status),
        day_count: input.dayCount,
        duration_seconds: input.durationSeconds,
        started_at: input.startedAt,
        abandon_phase: input.abandonPhase ?? "unknown",
        finished_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    ),
  );
}

export async function recordAbandonReason(input: {
  sessionId: string;
  reason: AbandonReason;
}): Promise<AnalyticsResult> {
  try {
    const client = analyticsClient();
    if (!client) return { status: "disabled" };
    const { data, error } = await client
      .from("tomatobot_play_sessions")
      .update({ abandon_reason: input.reason })
      .eq("id", input.sessionId)
      .in("status", ["cancelled", "reset"])
      .is("abandon_reason", null)
      .select("id");
    if (error) throw error;
    if (!data?.length) {
      console.error(
        `Play analytics abandon reason failed: no eligible session ${input.sessionId}`,
      );
      return { status: "failed" };
    }
    return { status: "saved" };
  } catch (error) {
    console.error(
      `Play analytics abandon reason failed: ${errorMessage(error)}`,
    );
    return { status: "failed" };
  }
}

export async function recordRematchRequested(
  sessionId: string,
): Promise<AnalyticsResult> {
  return save("rematch", (client) =>
    client
      .from("tomatobot_play_sessions")
      .update({ rematch_requested_at: new Date().toISOString() })
      .eq("id", sessionId),
  );
}

/**
 * セッションに参加した人間プレイヤーだけを匿名化して記録する。
 * NPC・表示名・役職・投票・会話内容は受け取らず、保存もしない。
 */
export async function recordSessionParticipants(input: {
  sessionId: string;
  participants: readonly SessionParticipantInput[];
}): Promise<AnalyticsResult> {
  try {
    const client = analyticsClient();
    if (!client) return { status: "disabled" };

    const participants = new Map<string, boolean>();
    for (const participant of input.participants) {
      const participantHash = anonymizeAnalyticsUserId(participant.userId);
      if (!participantHash) return { status: "disabled" };
      participants.set(
        participantHash,
        (participants.get(participantHash) ?? false) ||
          (participant.isHost ?? false),
      );
    }
    if (participants.size === 0) return { status: "saved" };

    const { error } = await client.from("tomatobot_play_participants").upsert(
      [...participants].map(([participantHash, isHost]) => ({
        session_id: input.sessionId,
        participant_hash: participantHash,
        is_host: isHost,
      })),
      { onConflict: "session_id,participant_hash" },
    );
    if (error) throw error;
    return { status: "saved" };
  } catch (error) {
    console.error(`Play analytics participants failed: ${errorMessage(error)}`);
    return { status: "failed" };
  }
}

export async function recordMatchFeedback(input: {
  sessionId: string;
  userId: string;
  rating: FeedbackRating;
  reason?: FeedbackReason;
  comment?: string;
}): Promise<FeedbackResult> {
  const comment = input.comment?.trim().slice(0, 1000) || null;
  try {
    const client = analyticsClient();
    if (!client) return { status: "disabled" };
    const participantHash = anonymizeAnalyticsUserId(input.userId);
    if (!participantHash) return { status: "disabled" };

    const { data, error } = await client.rpc(
      "tomatobot_submit_match_feedback",
      {
        p_session_id: input.sessionId,
        p_participant_hash: participantHash,
        p_rating: input.rating,
        p_reason: input.reason ?? null,
        p_comment: comment,
      },
    );
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const outcome =
      typeof row === "object" && row && "outcome" in row
        ? String(row.outcome)
        : "";
    if (outcome === "created" || outcome === "comment_appended") {
      return { status: "saved", outcome };
    }
    if (outcome === "locked") {
      const lockedRating =
        typeof row === "object" && row && "locked_rating" in row
          ? String(row.locked_rating)
          : undefined;
      return {
        status: "locked",
        rating:
          lockedRating === "again" ||
          lockedRating === "neutral" ||
          lockedRating === "issue"
            ? lockedRating
            : undefined,
      };
    }
    throw new Error("unexpected feedback result");
  } catch (error) {
    console.error(`Play analytics feedback failed: ${errorMessage(error)}`);
    return { status: "failed" };
  }
}
