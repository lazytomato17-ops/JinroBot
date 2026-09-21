import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";

const REQUEST_TIMEOUT_MS = 5000;
const MINIMUM_GAMES = 5;
const RANKING_LIMIT = 20;
const RANKING_JOIN_BUTTON_ID = "tomatobot-ranking-join";
const RANKING_LEAVE_BUTTON_ID = "tomatobot-ranking-leave";
export const RANKING_SITE_URL =
  "https://tomatobot-web.onrender.com/#ranking";

export type RankingMode = "friends" | "solo";

export interface PublicRankingEntry {
  rank: number;
  name: string;
  games: number;
  wins: number;
  losses: number;
  rate: number;
}

export interface PublicRankingPayload {
  season: string;
  minimumGames: number;
  generatedAt: string;
  rankings: Record<RankingMode, PublicRankingEntry[]>;
}

interface PublicRankingRow {
  mode: string;
  rank_position: number;
  public_name: string;
  games: number | string;
  wins: number | string;
  losses: number | string;
  win_rate: number;
}

export type PublicRankingResult =
  | { status: "found"; payload: PublicRankingPayload }
  | { status: "disabled" | "failed" };

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

function rankingClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_KEY?.trim();

  if (!url || !key) {
    if (!warnedAboutMissingConfig && process.env.NODE_ENV !== "test") {
      console.warn(
        "Public rankings are disabled: SUPABASE_URL and a Supabase secret key are required.",
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

function reportRankingError(action: string, error: unknown): void {
  console.error(`Ranking ${action} failed: ${errorMessage(error)}`);
}

function seasonInJapan(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

function validMode(mode: string): mode is RankingMode {
  return mode === "friends" || mode === "solo";
}

export function buildPublicRankingPayload(
  rows: PublicRankingRow[],
  now = new Date(),
): PublicRankingPayload {
  const rankings: Record<RankingMode, PublicRankingEntry[]> = {
    friends: [],
    solo: [],
  };

  for (const row of rows) {
    if (!validMode(row.mode)) continue;
    rankings[row.mode].push({
      rank: Number(row.rank_position),
      name: row.public_name,
      games: Number(row.games),
      wins: Number(row.wins),
      losses: Number(row.losses),
      rate: Number(row.win_rate),
    });
  }

  return {
    season: seasonInJapan(now),
    minimumGames: MINIMUM_GAMES,
    generatedAt: now.toISOString(),
    rankings,
  };
}

export async function getPublicRankings(): Promise<PublicRankingResult> {
  try {
    const client = rankingClient();
    if (!client) return { status: "disabled" };

    const { data, error } = await client.rpc("tomatobot_public_rankings", {
      p_min_games: MINIMUM_GAMES,
      p_limit: RANKING_LIMIT,
    });
    if (error) throw error;

    return {
      status: "found",
      payload: buildPublicRankingPayload(
        (data ?? []) as PublicRankingRow[],
      ),
    };
  } catch (error) {
    reportRankingError("read", error);
    return { status: "failed" };
  }
}

function publicName(displayName: string): string {
  const cleaned = displayName.replace(/[\n\r\t]/g, " ").trim();
  return (cleaned || "プレイヤー").slice(0, 32);
}

export function rankingJoinSuccessMessage(
  displayName: string,
  now = new Date(),
): string {
  const [year, month] = seasonInJapan(now).split("-");
  return [
    `ランキング参加設定を保存しました。公開名は「${publicName(displayName)}」です。`,
    "※参加しただけでは、まだ一覧には表示されません。",
    `${year}年${Number(month)}月の通常配役を${MINIMUM_GAMES}試合完走すると、自動で掲載されます。ランキングは毎月1日に試合数がリセットされます。`,
  ].join("\n");
}

async function joinRanking(
  userId: string,
  displayName: string,
): Promise<"saved" | "disabled" | "failed"> {
  try {
    const client = rankingClient();
    if (!client) return "disabled";
    const { error } = await client.from("tomatobot_ranking_profiles").upsert(
      {
        user_id: userId,
        public_name: publicName(displayName),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return "saved";
  } catch (error) {
    reportRankingError("join", error);
    return "failed";
  }
}

async function leaveRanking(
  userId: string,
): Promise<"saved" | "disabled" | "failed"> {
  try {
    const client = rankingClient();
    if (!client) return "disabled";
    const { error } = await client
      .from("tomatobot_ranking_profiles")
      .delete()
      .eq("user_id", userId);
    if (error) throw error;
    return "saved";
  } catch (error) {
    reportRankingError("leave", error);
    return "failed";
  }
}

type RankingAction = "join" | "leave";

async function changeRankingParticipation(
  action: RankingAction,
  userId: string,
  displayName: string,
): Promise<string> {
  const result =
    action === "join"
      ? await joinRanking(userId, displayName)
      : await leaveRanking(userId);

  if (result === "disabled") {
    return "ランキング機能は現在準備中です。人狼ゲームは通常どおり遊べます。";
  }
  if (result === "failed") {
    return "ランキング設定を変更できませんでした。少し待ってからもう一度お試しください。";
  }
  return action === "join"
    ? rankingJoinSuccessMessage(displayName)
    : "ランキングから退出しました。サイト上の名前と成績は表示されなくなります。";
}

export function rankingSettingsRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(RANKING_JOIN_BUTTON_ID)
      .setLabel("ランキングに参加")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(RANKING_LEAVE_BUTTON_ID)
      .setLabel("非公開にする")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel("ランキングを見る")
      .setStyle(ButtonStyle.Link)
      .setURL(RANKING_SITE_URL),
  );
}

export function isRankingButton(customId: string): boolean {
  return (
    customId === RANKING_JOIN_BUTTON_ID ||
    customId === RANKING_LEAVE_BUTTON_ID
  );
}

export async function handleRankingButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!isRankingButton(interaction.customId)) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const action: RankingAction =
    interaction.customId === RANKING_JOIN_BUTTON_ID ? "join" : "leave";
  await interaction.editReply(
    await changeRankingParticipation(
      action,
      interaction.user.id,
      interaction.user.displayName,
    ),
  );
}

export async function handleRankingCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const action = interaction.options.getSubcommand() as RankingAction;
  await interaction.editReply(
    await changeRankingParticipation(
      action,
      interaction.user.id,
      interaction.user.displayName,
    ),
  );
}
