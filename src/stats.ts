import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  MessageFlags,
} from "discord.js";
import { ROLE_INFO, ROLE_NAMES } from "./roles";
import { rankingSettingsRow } from "./ranking";
import type { RoleName, Winner } from "./types";

const STATS_COLOR = 0x5865f2;
const REQUEST_TIMEOUT_MS = 5000;

export interface GameStatsPlayer {
  userId: string;
  displayName: string;
  role: RoleName;
  won: boolean;
  survived: boolean;
}

export interface RecordGameStatsInput {
  matchId: string;
  guildId: string;
  channelId: string;
  winner: Winner;
  dayCount: number;
  players: GameStatsPlayer[];
}

export interface RoleStats {
  role: RoleName;
  games: number;
  wins: number;
}

export interface PlayerStats {
  userId: string;
  displayName: string;
  games: number;
  wins: number;
  currentStreak: number;
  bestStreak: number;
  roles: RoleStats[];
}

export type RecordGameStatsResult =
  | { status: "saved"; players: PlayerStats[] }
  | { status: "disabled" | "failed"; players: [] };

export type PlayerStatsResult =
  | { status: "found"; stats: PlayerStats }
  | { status: "not-found" | "disabled" | "failed" };

interface PlayerStatsRow {
  user_id: string;
  display_name: string;
  games: number;
  wins: number;
  current_streak: number;
  best_streak: number;
}

interface RoleStatsRow {
  user_id: string;
  role: string;
  games: number;
  wins: number;
}

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

function statsClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_KEY?.trim();

  if (!url || !key) {
    if (!warnedAboutMissingConfig && process.env.NODE_ENV !== "test") {
      console.warn(
        "Stats are disabled: SUPABASE_URL and a Supabase secret key are required.",
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

function reportStatsError(action: string, error: unknown): void {
  console.error(`Stats ${action} failed: ${errorMessage(error)}`);
}

function isRoleName(role: string): role is RoleName {
  return ROLE_NAMES.includes(role as RoleName);
}

function combineStats(
  profileRows: PlayerStatsRow[],
  roleRows: RoleStatsRow[],
): PlayerStats[] {
  return profileRows.map((profile) => ({
    userId: profile.user_id,
    displayName: profile.display_name,
    games: profile.games,
    wins: profile.wins,
    currentStreak: profile.current_streak,
    bestStreak: profile.best_streak,
    roles: roleRows
      .filter((row) => row.user_id === profile.user_id && isRoleName(row.role))
      .map((row) => ({
        role: row.role as RoleName,
        games: row.games,
        wins: row.wins,
      })),
  }));
}

async function fetchPlayerStatsRows(
  client: SupabaseClient,
  userIds: string[],
): Promise<PlayerStats[]> {
  if (userIds.length === 0) return [];
  const [profilesResult, rolesResult] = await Promise.all([
    client
      .from("tomatobot_player_stats")
      .select("user_id,display_name,games,wins,current_streak,best_streak")
      .in("user_id", userIds),
    client
      .from("tomatobot_player_role_stats")
      .select("user_id,role,games,wins")
      .in("user_id", userIds),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (rolesResult.error) throw rolesResult.error;
  return combineStats(
    (profilesResult.data ?? []) as PlayerStatsRow[],
    (rolesResult.data ?? []) as RoleStatsRow[],
  );
}

export async function recordGameStats(
  input: RecordGameStatsInput,
): Promise<RecordGameStatsResult> {
  try {
    const client = statsClient();
    if (!client) return { status: "disabled", players: [] };
    if (input.players.length === 0) return { status: "saved", players: [] };

    const { error } = await client.rpc("tomatobot_record_game_result", {
      p_match_id: input.matchId,
      // Location is not needed for personal stats. Keeping a fixed value also
      // prevents a stats row from being joined back to anonymous play analytics.
      p_guild_id: "not-collected",
      p_channel_id: "not-collected",
      p_winner: input.winner,
      p_day_count: input.dayCount,
      p_players: input.players.map((player) => ({
        user_id: player.userId,
        display_name: player.displayName,
        role: player.role,
        won: player.won,
        survived: player.survived,
      })),
    });
    if (error) throw error;

    const players = await fetchPlayerStatsRows(
      client,
      input.players.map((player) => player.userId),
    );
    return { status: "saved", players };
  } catch (error) {
    reportStatsError("record", error);
    return { status: "failed", players: [] };
  }
}

export async function getPlayerStats(
  userId: string,
): Promise<PlayerStatsResult> {
  try {
    const client = statsClient();
    if (!client) return { status: "disabled" };

    const players = await fetchPlayerStatsRows(client, [userId]);
    const stats = players[0];
    return stats ? { status: "found", stats } : { status: "not-found" };
  } catch (error) {
    reportStatsError("read", error);
    return { status: "failed" };
  }
}

function recordText(games: number, wins: number): string {
  const losses = games - wins;
  const rate = games > 0 ? Math.round((wins / games) * 100) : 0;
  return `${games}戦 ${wins}勝 ${losses}敗（${rate}%）`;
}

export function statsEmbed(
  stats: PlayerStats,
  currentDisplayName = stats.displayName,
): EmbedBuilder {
  const roleLines = ROLE_NAMES.map((role) =>
    stats.roles.find((entry) => entry.role === role),
  )
    .filter((entry): entry is RoleStats => Boolean(entry))
    .map(
      (entry) =>
        `${ROLE_INFO[entry.role].icon} **${entry.role}**　${recordText(entry.games, entry.wins)}`,
    );

  return new EmbedBuilder()
    .setTitle(`戦績｜${escapeMarkdown(currentDisplayName)}`)
    .addFields(
      {
        name: "通算",
        value: `**${recordText(stats.games, stats.wins)}**`,
      },
      {
        name: "連勝",
        value: `現在 **${stats.currentStreak}**｜最高 **${stats.bestStreak}**`,
      },
      {
        name: "役職別",
        value: roleLines.join("\n") || "まだ記録がありません。",
      },
    )
    .setColor(STATS_COLOR)
    .setFooter({ text: "NPC戦を含む、自分が参加した試合の記録です" });
}

export function gameStatsRows(
  participants: GameStatsPlayer[],
  stats: PlayerStats[],
): string {
  return participants
    .map((participant) => {
      const total = stats.find((entry) => entry.userId === participant.userId);
      if (!total) return undefined;
      const streak =
        total.currentStreak >= 2 ? `｜${total.currentStreak}連勝` : "";
      return `**${escapeMarkdown(participant.displayName)}**｜${ROLE_INFO[participant.role].icon} ${participant.role}で${participant.won ? "勝利" : "敗北"}｜通算 ${total.wins}勝${total.games - total.wins}敗${streak}`;
    })
    .filter((row): row is string => Boolean(row))
    .join("\n");
}

export function gameStatsFields(
  participants: GameStatsPlayer[],
  stats: PlayerStats[],
): Array<{ name: string; value: string }> {
  const lines = gameStatsRows(participants, stats).split("\n").filter(Boolean);
  const chunks: string[] = [];

  for (const line of lines) {
    const current = chunks.at(-1);
    if (!current || current.length + line.length + 1 > 1000) {
      chunks.push(line);
    } else {
      chunks[chunks.length - 1] = `${current}\n${line}`;
    }
  }

  return chunks.map((value, index) => ({
    name: index === 0 ? "プレイヤー戦績" : "プレイヤー戦績（続き）",
    value,
  }));
}

export async function showStats(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await getPlayerStats(interaction.user.id);

  if (result.status === "found") {
    await interaction.editReply({
      embeds: [statsEmbed(result.stats, interaction.user.displayName)],
      components: [rankingSettingsRow()],
    });
    return;
  }

  if (result.status === "not-found") {
    await interaction.editReply({
      content: "まだ戦績がありません。人狼ゲームを最後まで遊ぶと記録されます。",
      components: [rankingSettingsRow()],
    });
    return;
  }

  if (result.status === "disabled") {
    await interaction.editReply(
      "戦績機能は現在準備中です。人狼ゲームは通常どおり遊べます。",
    );
    return;
  }

  await interaction.editReply(
    "戦績を読み込めませんでした。少し待ってからもう一度お試しください。",
  );
}
