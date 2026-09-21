import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  Message,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Guild, MessageCreateOptions, User } from "discord.js";
import { randomUUID } from "node:crypto";
import { isBetaTester } from "./access";
import {
  recordAbandonReason,
  recordGameAbandoned,
  recordGameCompleted,
  recordGameStarted,
  recordLobbyOpened,
  recordMatchFeedback,
  recordRematchRequested,
  recordSessionParticipants,
  type AbandonPhase,
  type AbandonReason,
  type FeedbackRating,
  type FeedbackReason,
  type PlaySessionSnapshot,
} from "./analytics";
import {
  buildCustomRoles,
  buildRoles,
  CONFIGURABLE_ROLE_NAMES,
  getWinner,
  isActualWolfRole,
  isWolfTeamRole,
  ROLE_INFO,
  ROLE_NAMES,
  roleConfigFromRoles,
  seerResultForRole,
  shuffle,
  usesUnrestrictedRoleConfig,
} from "./roles";
import {
  assignGameRoles,
  buildSoloRoles,
  chooseNpcRevoteTarget,
  chooseNpcVoteTarget,
  SOLO_PLAYER_COUNT,
} from "./solo";
import {
  addPublicClaimSuspicion,
  conflictingSeerClaimantIds,
  chooseNpcQuestionAnswer,
  chooseStrategicNightTarget,
  findNpcInsight,
  HUMAN_ARGUMENT_REASONS,
  MADMAN_WHITE_CLAIM_CHANCE,
  npcSeerClaimPlanStartsOnDay,
  npcDecisionSuspicion,
  npcOpinionLine,
  personalityForSerial,
  planNpcSeerClaims,
  isRoleClaimOverCapacity,
  roleClaimantIds,
} from "./npc";
export { npcDecisionSuspicion } from "./npc";
import {
  countVotes,
  discussionDuration,
  relativeTime,
  resolveVoteOutcome,
  topVotedIds,
} from "./presentation";
import { gameStatsFields, recordGameStats } from "./stats";
import { rankingSettingsRow } from "./ranking";
import type {
  ClaimedRole,
  GameState,
  HumanArgument,
  HumanArgumentReason,
  Player,
  PublicResult,
  RoleName,
  Winner,
} from "./types";

const VOTE_SECONDS = 45;
const NIGHT_SECONDS = 45;
const VOTE_MIN_SECONDS = 10;
const NIGHT_MIN_SECONDS = 8;
const VOTE_REVEAL_SECONDS = 5;
const NIGHT_REVEAL_SECONDS = 6;
const SEER_AUTO_SECONDS = 30;
const RESULT_HOLD_SECONDS = 4;
const START_HOLD_SECONDS = 4;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 15;
const NPC_QUESTIONS_PER_DAY = 2;
const WOLF_CHAT_MESSAGES_PER_NIGHT = 2;
const ABANDON_REASON_WINDOW_MS = 10 * 60 * 1000;
const LOQUACIOUS_WORDS = [
  "投票",
  "占い",
  "怪しい",
  "白い",
  "昨日",
  "理由",
  "対抗",
  "様子",
];
const DIVISION_CHANNEL_TOPIC_PREFIX = "jinrobot-division:v1:";

const games = new Map<string, GameState>();

const COLORS = {
  lobby: 0x5865f2,
  day: 0xf0b232,
  vote: 0x9b59b6,
  night: 0x2b2d31,
  danger: 0xed4245,
  success: 0x57f287,
};

const FEEDBACK_REASON_INFO: Record<
  FeedbackReason,
  { label: string; emoji: string }
> = {
  npc: { label: "NPCの動き", emoji: "🤖" },
  tempo: { label: "テンポ", emoji: "⏱️" },
  controls: { label: "操作", emoji: "🎮" },
  roles: { label: "配役バランス", emoji: "⚖️" },
  bug: { label: "不具合", emoji: "🛠️" },
  other: { label: "その他", emoji: "💬" },
};
const ABANDON_REASON_OPTIONS: ReadonlyArray<{
  action: string;
  reason: AbandonReason;
  label: string;
}> = [
  { action: "reroll", reason: "reroll_role", label: "役職を変えたい" },
  { action: "testing", reason: "testing_config", label: "配役を試していた" },
  { action: "controls", reason: "controls", label: "操作が分からない" },
  { action: "too-long", reason: "too_long", label: "長く感じた" },
  { action: "other", reason: "other", label: "その他" },
];

interface PendingAbandonReason {
  channelId: string;
  sessionId: string;
  userId: string;
  expiresAt: number;
  analyticsReady: Promise<void>;
  submitting: boolean;
}

const pendingAbandonReasons = new Map<string, PendingAbandonReason>();
const NPC_NAMES = [
  "アカネ",
  "レン",
  "ミオ",
  "ハル",
  "ソラ",
  "ユズ",
  "ナギ",
  "リン",
  "カイ",
  "モモ",
  "シロ",
  "ルナ",
  "トワ",
  "コウ",
];

const HUMAN_ARGUMENT_INFO: Record<
  HumanArgumentReason,
  { label: string; description: string; publicText: string; emoji: string }
> = {
  "black-result": {
    label: "人狼判定が出ている",
    description: "公開された占い結果を根拠にします",
    publicText: "占い師COから人狼判定が出ている",
    emoji: "🐺",
  },
  "vote-contradiction": {
    label: "発言と投票が矛盾",
    description: "占い結果と投票先の食い違いを指摘します",
    publicText: "占い結果と投票先が矛盾している",
    emoji: "🗳️",
  },
  "broken-claim": {
    label: "占いCOが破綻",
    description: "人狼数や処刑結果との矛盾を指摘します",
    publicText: "公開情報から占いCOが破綻している",
    emoji: "⚠️",
  },
  "counter-claim": {
    label: "対抗COが出ている",
    description: "複数COや判定の食い違いを疑います",
    publicText: "対抗COまたは判定の食い違いが気になる",
    emoji: "🎭",
  },
  "previous-votes": {
    label: "前日の得票が多い",
    description: "前日の投票結果を根拠にします",
    publicText: "前日の投票で票が集まっている",
    emoji: "📊",
  },
  intuition: {
    label: "直感・違和感",
    description: "明確な証拠はないが疑いを表明します",
    publicText: "今のところ一番違和感がある",
    emoji: "💭",
  },
};
function componentId(action: string, game: GameState): string {
  return `tb:${action}:${game.channelId}:${analyticsSnapshot(game).sessionId}:${game.day}`;
}

export interface ParsedGameComponentId {
  action: string;
  channelId: string;
  /** 通常の試合操作だけが持つ試合ID。結果・感想・終了理由は value 側で照合する。 */
  sessionId?: string;
  value: string;
}

export function parseGameComponentId(
  customId: string,
): ParsedGameComponentId | undefined {
  const parts = customId.split(":");
  if (parts[0] !== "tb" || (parts.length !== 4 && parts.length !== 5))
    return undefined;
  const [, action, channelId] = parts;
  if (!action || !channelId) return undefined;
  return parts.length === 5
    ? { action, channelId, sessionId: parts[3], value: parts[4] }
    : { action, channelId, value: parts[3] };
}

export function hasCurrentGameSession(
  game: Pick<GameState, "analyticsSessionId">,
  sessionId: string | undefined,
): boolean {
  return Boolean(sessionId && sessionId === game.analyticsSessionId);
}

function resultComponentId(action: string, game: GameState): string {
  return `tb:${action}:${game.channelId}:${analyticsSnapshot(game).sessionId}`;
}

function feedbackComponentId(action: string, game: GameState): string {
  analyticsSnapshot(game);
  return `tb:${action}:${game.channelId}:${game.analyticsChainId}`;
}

function abandonReasonComponentId(
  action: string,
  channelId: string,
  sessionId: string,
): string {
  return `tb:abandon-${action}:${channelId}:${sessionId}`;
}

export function abandonReasonFromAction(
  action: string,
): AbandonReason | undefined {
  return ABANDON_REASON_OPTIONS.find(
    (option) => `abandon-${option.action}` === action,
  )?.reason;
}

export function abandonReasonRows(channelId: string, sessionId: string) {
  return [
    ABANDON_REASON_OPTIONS.slice(0, 3),
    ABANDON_REASON_OPTIONS.slice(3),
  ].map((options) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      options.map((option) =>
        new ButtonBuilder()
          .setCustomId(
            abandonReasonComponentId(option.action, channelId, sessionId),
          )
          .setLabel(option.label)
          .setStyle(ButtonStyle.Secondary),
      ),
    ),
  );
}

function analyticsSnapshot(game: GameState): PlaySessionSnapshot {
  game.analyticsSessionId ??= randomUUID();
  game.analyticsChainId ??= game.analyticsSessionId;
  return {
    sessionId: game.analyticsSessionId,
    sourceSessionId: game.analyticsSourceSessionId,
    chainId: game.analyticsChainId,
    guildId: game.channel.guildId,
    channelId: game.channelId,
    targetPlayerCount: game.targetPlayerCount,
    humanCount: game.players.filter((player) => !player.isNpc).length,
    npcCount: game.players.filter((player) => player.isNpc).length,
    roleConfig: { ...game.roleConfig },
  };
}

function analyticsAbandonPhase(game: GameState): AbandonPhase {
  if (game.starting || (game.phase === "lobby" && game.day > 0))
    return "role_setup";
  if (game.phase === "day") return "discussion";
  if (game.phase === "voting") return "voting";
  if (game.phase === "night") return "night";
  return game.phase;
}

function queueAnalytics(
  game: GameState,
  operation: () => Promise<unknown>,
): void {
  game.analyticsPending = (game.analyticsPending ?? Promise.resolve())
    .then(operation)
    .then(() => undefined)
    .catch((error) => {
      console.error("Play analytics queue failed:", error);
    });
}

function playedSeconds(game: GameState): number | undefined {
  if (!game.analyticsStartedAt) return undefined;
  return Math.max(0, Math.round((Date.now() - game.analyticsStartedAt) / 1000));
}

function clearGameTimers(game: GameState): void {
  for (const timer of game.timers) clearTimeout(timer);
  game.timers = [];
}

function schedule(
  game: GameState,
  delayMs: number,
  callback: () => void | Promise<void>,
): void {
  game.timers.push(
    setTimeout(() => {
      Promise.resolve()
        .then(callback)
        .catch((error) => {
          console.error(
            `Scheduled game task failed (day ${game.day}, ${game.phase}):`,
            error,
          );
        });
    }, delayMs),
  );
}

function runGameTask(label: string, operation: () => Promise<void>): void {
  void operation().catch((error) => {
    console.error(`${label} failed:`, error);
  });
}

export function discussionSecondsForGame(
  _game: GameState,
  playerCount: number,
  humanCount: number,
): number {
  return discussionDuration(playerCount, humanCount);
}

export function remainingPhaseMinimumMs(
  startedAt: number | undefined,
  minimumSeconds: number,
  now: number = Date.now(),
): number {
  if (!startedAt) return 0;
  return Math.max(0, startedAt + minimumSeconds * 1000 - now);
}

type PhaseRow =
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<StringSelectMenuBuilder>;

interface PhasePayload {
  content?: string;
  embeds: EmbedBuilder[];
  components?: PhaseRow[];
}

function isActiveGame(game: GameState): boolean {
  return games.get(game.channelId) === game;
}

function gameForChannelId(channelId: string): GameState | undefined {
  return (
    games.get(channelId) ??
    [...games.values()].find((game) =>
      [...(game.divisionChannels?.values() ?? [])].some(
        (channel) => channel.id === channelId,
      ),
    )
  );
}

type ExplicitViewPermission = "allow" | "deny" | "inherit";

interface DivisionRecoverySnapshot {
  mainChannelId: string;
  permissions: Map<string, ExplicitViewPermission>;
}

function divisionRecoveryTopic(
  mainChannelId: string,
  permissions: ReadonlyMap<string, ExplicitViewPermission>,
): string {
  const code = { allow: "a", deny: "d", inherit: "i" } as const;
  const entries = [...permissions].map(
    ([id, permission]) => `${id}.${code[permission]}`,
  );
  return `${DIVISION_CHANNEL_TOPIC_PREFIX}${mainChannelId}:${entries.join(",")}`;
}

export function divisionRecoverySnapshotFromTopic(
  topic: string | null,
): DivisionRecoverySnapshot | undefined {
  if (!topic?.startsWith(DIVISION_CHANNEL_TOPIC_PREFIX)) return undefined;
  const payload = topic.slice(DIVISION_CHANNEL_TOPIC_PREFIX.length);
  const separator = payload.indexOf(":");
  if (separator < 1) return undefined;
  const mainChannelId = payload.slice(0, separator);
  if (!/^\d+$/.test(mainChannelId)) return undefined;
  const permissions = new Map<string, ExplicitViewPermission>();
  const permissionCode: Record<string, ExplicitViewPermission> = {
    a: "allow",
    d: "deny",
    i: "inherit",
  };
  for (const entry of payload.slice(separator + 1).split(",")) {
    const [id, code] = entry.split(".");
    const permission = permissionCode[code];
    if (!/^\d+$/.test(id) || !permission) return undefined;
    permissions.set(id, permission);
  }
  return permissions.size > 0 ? { mainChannelId, permissions } : undefined;
}

function explicitViewPermission(
  channel: TextChannel,
  overwriteId: string,
): ExplicitViewPermission {
  const overwrite = channel.permissionOverwrites.cache.get(overwriteId);
  if (overwrite?.allow.has(PermissionFlagsBits.ViewChannel)) return "allow";
  if (overwrite?.deny.has(PermissionFlagsBits.ViewChannel)) return "deny";
  return "inherit";
}

function viewPermissionValue(
  permission: ExplicitViewPermission,
): boolean | null {
  if (permission === "allow") return true;
  if (permission === "deny") return false;
  return null;
}

function divisionChannelForPlayer(
  game: GameState,
  player: Player,
): TextChannel {
  const group = game.divisionGroups?.get(player.id);
  return (group && game.divisionChannels?.get(group)) || game.channel;
}

function sharesDiscussionRoom(
  game: GameState,
  left: Player,
  right: Player,
): boolean {
  const leftGroup = game.divisionGroups?.get(left.id);
  return !leftGroup || game.divisionGroups?.get(right.id) === leftGroup;
}

async function sendDiscussionMessage(
  game: GameState,
  speaker: Player,
  content: string,
): Promise<Message> {
  return divisionChannelForPlayer(game, speaker).send(content);
}

async function restoreDivisionChannels(
  game: GameState,
  reason: string,
): Promise<void> {
  const channels = [...(game.divisionChannels?.values() ?? [])];
  const originalPermissions = game.divisionOriginalViewPermissions;

  if (originalPermissions) {
    for (const [overwriteId, permission] of originalPermissions) {
      await game.channel.permissionOverwrites.edit(overwriteId, {
        ViewChannel: viewPermissionValue(permission),
      });
    }
  }

  game.divisionChannels = undefined;
  game.divisionPhaseMessages = undefined;
  game.divisionOriginalViewPermissions = undefined;
  game.divisionGroups = new Map();

  await Promise.all(
    channels.map((channel) =>
      channel.delete(reason).catch((error) => {
        console.error(`Division channel delete failed (${channel.id}):`, error);
      }),
    ),
  );
}

function hasDivisionChannelPermission(game: GameState): boolean {
  const botMember = game.channel.guild.members.me;
  return Boolean(
    botMember &&
    game.channel
      .permissionsFor(botMember)
      .has(PermissionFlagsBits.ManageChannels),
  );
}

async function activateDivisionChannels(game: GameState): Promise<boolean> {
  const groups = game.divisionGroups;
  if (!groups || groups.size === 0) return true;
  const botMember = game.channel.guild.members.me;
  if (!botMember || !hasDivisionChannelPermission(game)) {
    game.divisionGroups = new Map();
    await game.channel
      .send(
        "⚠️ 分断者の能力を使うには、Botロールの「チャンネル管理」権限が必要です。今回は分断せずに進行します。",
      )
      .catch(() => undefined);
    return false;
  }

  const everyoneId = game.channel.guild.roles.everyone.id;
  const humanIds = aliveHumans(game).map((player) => player.id);
  const overwriteIds = [everyoneId, ...humanIds];
  game.divisionOriginalViewPermissions = new Map(
    overwriteIds.map((id) => [id, explicitViewPermission(game.channel, id)]),
  );
  game.divisionChannels = new Map();

  try {
    for (const group of ["A", "B"] as const) {
      const memberIds = alivePlayers(game)
        .filter(
          (player) =>
            !player.isNpc && game.divisionGroups?.get(player.id) === group,
        )
        .map((player) => player.id);
      const channel = await game.channel.guild.channels.create({
        name: `人狼-${group.toLowerCase()}-${game.day}日目`,
        type: ChannelType.GuildText,
        parent: game.channel.parentId,
        topic: divisionRecoveryTopic(
          game.channelId,
          game.divisionOriginalViewPermissions,
        ),
        permissionOverwrites: [
          {
            id: everyoneId,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: botMember.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          ...memberIds.map((id) => ({
            id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          })),
        ],
        reason: `人狼ゲーム ${game.day}日目：分断者の能力`,
      });
      game.divisionChannels.set(group, channel);
    }

    for (const overwriteId of overwriteIds) {
      await game.channel.permissionOverwrites.edit(overwriteId, {
        ViewChannel: false,
      });
    }
    return true;
  } catch (error) {
    console.error("Division channel setup failed:", error);
    try {
      await restoreDivisionChannels(game, "分断チャンネルの作成失敗");
    } catch (restoreError) {
      console.error("Division permission restore failed:", restoreError);
    }
    await game.channel
      .send(
        "⚠️ 分断用チャンネルを作成できなかったため、今回は分断せずに進行します。Botの「チャンネル管理」権限を確認してください。",
      )
      .catch(() => undefined);
    return false;
  }
}

export async function recoverOrphanedDivisionChannels(
  guilds: Iterable<Guild>,
): Promise<number> {
  let recovered = 0;
  for (const guild of guilds) {
    await guild.channels.fetch().catch((error) => {
      console.error(
        `Division recovery channel fetch failed (${guild.id}):`,
        error,
      );
    });
    const sectors = [...guild.channels.cache.values()].flatMap((channel) => {
      if (channel.type !== ChannelType.GuildText) return [];
      const snapshot = divisionRecoverySnapshotFromTopic(channel.topic);
      return snapshot ? [{ channel, snapshot }] : [];
    });
    const byMainChannel = new Map<string, typeof sectors>();
    for (const sector of sectors) {
      const entries = byMainChannel.get(sector.snapshot.mainChannelId) ?? [];
      entries.push(sector);
      byMainChannel.set(sector.snapshot.mainChannelId, entries);
    }

    for (const [mainChannelId, entries] of byMainChannel) {
      const mainChannel = guild.channels.cache.get(mainChannelId);
      try {
        if (mainChannel?.type === ChannelType.GuildText) {
          for (const [overwriteId, permission] of entries[0].snapshot
            .permissions) {
            await mainChannel.permissionOverwrites.edit(overwriteId, {
              ViewChannel: viewPermissionValue(permission),
            });
          }
        }
        await Promise.all(
          entries.map(({ channel }) =>
            channel.delete("Bot再起動による分断状態の復旧"),
          ),
        );
        recovered += 1;
      } catch (error) {
        console.error(
          `Orphaned division recovery failed (${guild.id}/${mainChannelId}):`,
          error,
        );
      }
    }
  }
  return recovered;
}

async function terminateAfterPhasePanelFailure(game: GameState): Promise<void> {
  if (!isActiveGame(game)) return;
  if (!game.analyticsCompleted) {
    const startedAt = game.analyticsStartedAt;
    const analytics = {
      ...analyticsSnapshot(game),
      status: startedAt ? ("reset" as const) : ("cancelled" as const),
      dayCount: startedAt ? game.day : 0,
      durationSeconds: playedSeconds(game),
      abandonPhase: analyticsAbandonPhase(game),
      startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
    };
    game.analyticsCompleted = true;
    queueAnalytics(game, () => recordGameAbandoned(analytics));
  }
  clearGameTimers(game);
  game.phase = "ended";
  game.resolving = true;
  game.resolutionQueued = false;
  game.starting = false;
  await restoreDivisionChannels(game, "ゲーム進行エラーによる分断解除").catch(
    (error) =>
      console.error("Division cleanup after panel failure failed:", error),
  );
  games.delete(game.channelId);
  await disableFeedbackPanel(game);
}

async function openPhasePanel(
  game: GameState,
  payload: PhasePayload,
): Promise<boolean> {
  if (!isActiveGame(game)) return false;
  let message: Message;
  try {
    message = await game.channel.send(payload);
  } catch (error) {
    console.error(
      `Phase panel send failed (day ${game.day}, ${game.phase}):`,
      error,
    );
    if (isActiveGame(game)) {
      await terminateAfterPhasePanelFailure(game);
      await (game.phaseMessage ?? game.lobbyMessage)
        ?.edit({
          content:
            "進行メッセージを送信できなかったため、ゲームを終了しました。Botのチャンネル権限を確認してください。",
          embeds: [],
          components: [],
        })
        .catch(() => undefined);
    }
    return false;
  }
  if (!isActiveGame(game)) {
    await message.edit({ components: [] }).catch(() => undefined);
    return false;
  }
  game.phaseMessage = message;
  return true;
}

async function openDiscussionPanels(
  game: GameState,
  components: PhaseRow[],
): Promise<boolean> {
  const channels = game.divisionChannels;
  if (!channels || channels.size === 0) {
    return openPhasePanel(game, {
      content: "",
      embeds: [dayEmbed(game)],
      components,
    });
  }

  const messages: Message[] = [];
  try {
    for (const group of ["A", "B"] as const) {
      const channel = channels.get(group);
      if (!channel) throw new Error(`Division channel ${group} is missing.`);
      messages.push(
        await channel.send({
          content: "",
          embeds: [dayEmbed(game, group)],
          components,
        }),
      );
    }
  } catch (error) {
    console.error(`Division panel send failed (day ${game.day}):`, error);
    await Promise.all(
      messages.map((message) =>
        message.edit({ components: [] }).catch(() => undefined),
      ),
    );
    await restoreDivisionChannels(game, "分断議論の開始失敗").catch(
      (restoreError) =>
        console.error(
          "Division cleanup after panel failure failed:",
          restoreError,
        ),
    );
    await terminateAfterPhasePanelFailure(game);
    return false;
  }

  if (!isActiveGame(game)) {
    await Promise.all(
      messages.map((message) =>
        message.edit({ components: [] }).catch(() => undefined),
      ),
    );
    return false;
  }
  game.divisionPhaseMessages = messages;
  game.phaseMessage = messages[0];
  return true;
}

async function updateOrReplacePhasePanel(
  game: GameState,
  payload: PhasePayload,
): Promise<boolean> {
  if (!isActiveGame(game)) return false;
  const current = game.phaseMessage;
  if (current) {
    try {
      await current.edit(payload);
      return isActiveGame(game);
    } catch (error) {
      console.error(
        `Phase panel edit failed; sending a replacement (day ${game.day}, ${game.phase}):`,
        error,
      );
    }
  }
  return openPhasePanel(game, payload);
}

function alivePlayers(game: GameState): Player[] {
  return game.players.filter((player) => player.alive);
}

function aliveHumans(game: GameState): Player[] {
  return alivePlayers(game).filter((player) => !player.isNpc);
}

function safeName(player: Player): string {
  return escapeMarkdown(player.name);
}

export function publicResultForRole(role?: RoleName): PublicResult {
  return seerResultForRole(role);
}

function loverPairs(game: GameState): Array<[string, string]> {
  game.loverPairs ??= [];
  return game.loverPairs;
}

function devoteeTargets(game: GameState): Map<string, string> {
  game.devoteeTargets ??= new Map();
  return game.devoteeTargets;
}

function usedRolePowers(game: GameState): Set<string> {
  game.usedRolePowers ??= new Set();
  return game.usedRolePowers;
}

function fatalWoundIds(game: GameState): Set<string> {
  game.fatalWoundIds ??= new Set();
  return game.fatalWoundIds;
}

function loquaciousMissions(game: GameState): Map<string, string> {
  game.loquaciousMissions ??= new Map();
  return game.loquaciousMissions;
}

function loquaciousCompleted(game: GameState): Set<string> {
  game.loquaciousCompleted ??= new Set();
  return game.loquaciousCompleted;
}

function winnerFor(game: GameState): Winner | null {
  return getWinner(game.players, { loverPairs: loverPairs(game) });
}

function effectivePlayerTeam(
  game: GameState,
  player: Player,
  visited = new Set<string>(),
): string {
  if (loverPairs(game).some((pair) => pair.includes(player.id)))
    return "lovers";
  if (player.role === "妖狐") return "fox";
  if (player.role === "てるてる") return "teruteru";
  if (player.role === "純愛者" && !visited.has(player.id)) {
    visited.add(player.id);
    const targetId = devoteeTargets(game).get(player.id);
    const target = game.players.find((candidate) => candidate.id === targetId);
    if (target) return effectivePlayerTeam(game, target, visited);
  }
  return player.role ? ROLE_INFO[player.role].team : "villager";
}

function memoryFor(game: GameState, npcId: string): Map<string, number> {
  const memory = game.npcMemory.get(npcId) ?? new Map<string, number>();
  game.npcMemory.set(npcId, memory);
  return memory;
}

function rememberSuspect(
  game: GameState,
  npcId: string,
  targetId: string,
  amount: number,
): void {
  const memory = memoryFor(game, npcId);
  memory.set(targetId, (memory.get(targetId) ?? 0) + amount);
}

function decayNpcMemory(game: GameState): void {
  const livingIds = new Set(alivePlayers(game).map((player) => player.id));
  for (const memory of game.npcMemory.values()) {
    for (const [targetId, score] of memory) {
      if (!livingIds.has(targetId)) memory.delete(targetId);
      else if (Math.abs(score) < 0.25) memory.delete(targetId);
      else memory.set(targetId, score * 0.75);
    }
  }
}

export function recordRoleClaim(
  game: GameState,
  speaker: Player,
  claimedRole: "占い師" | "霊能者",
  target: Player,
  result: PublicResult,
  resultDay?: number,
): boolean {
  const availableDays = availableClaimDays(game, speaker.id, claimedRole);
  const assignedResultDay = resultDay ?? availableDays[0];
  if (!assignedResultDay || !availableDays.includes(assignedResultDay))
    return false;
  if (
    game.npcClaims.some(
      (claim) =>
        claim.speakerId === speaker.id &&
        claim.claimedRole === claimedRole &&
        (claim.resultDay ?? claim.day) === assignedResultDay,
    )
  )
    return false;
  const claim = {
    day: game.day,
    resultDay: assignedResultDay,
    speakerId: speaker.id,
    claimedRole,
    targetId: target.id,
    result,
  } as const;
  game.npcClaims.push(claim);
  game.claimHistory.push({ action: "claim", ...claim });
  return true;
}

function recordGuardDeclaration(game: GameState, speaker: Player): boolean {
  const declaration = `${game.day}:${speaker.id}:騎士`;
  if (game.roleDeclarations.has(declaration)) return false;
  game.roleDeclarations.add(declaration);
  game.claimHistory.push({
    action: "claim",
    day: game.day,
    speakerId: speaker.id,
    claimedRole: "騎士",
  });
  return true;
}

export function claimedRoleForPlayer(
  game: GameState,
  playerId: string,
): ClaimedRole | undefined {
  const resultClaim = game.npcClaims.find(
    (claim) => claim.speakerId === playerId,
  );
  if (resultClaim) return resultClaim.claimedRole;
  return [...game.roleDeclarations].some(
    (declaration) => declaration.split(":")[1] === playerId,
  )
    ? "騎士"
    : undefined;
}

function playerResultClaims(
  game: GameState,
  playerId: string,
  claimedRole: "占い師" | "霊能者",
) {
  return game.npcClaims.filter(
    (claim) =>
      claim.speakerId === playerId && claim.claimedRole === claimedRole,
  );
}

function usedClaimDays(
  game: GameState,
  playerId: string,
  claimedRole: "占い師" | "霊能者",
): Set<number> {
  const maxDay =
    claimedRole === "占い師" ? game.day : game.executionHistory.length;
  const used = new Set<number>();
  for (const claim of playerResultClaims(game, playerId, claimedRole)) {
    const explicitDay = claim.resultDay;
    if (
      explicitDay !== undefined &&
      explicitDay >= 1 &&
      explicitDay <= maxDay &&
      !used.has(explicitDay)
    ) {
      used.add(explicitDay);
      continue;
    }
    const fallbackDay = Array.from(
      { length: maxDay },
      (_, index) => index + 1,
    ).find((day) => !used.has(day));
    if (fallbackDay !== undefined) used.add(fallbackDay);
  }
  return used;
}

export function availableClaimDays(
  game: GameState,
  playerId: string,
  claimedRole: "占い師" | "霊能者",
): number[] {
  const maxDay =
    claimedRole === "占い師" ? game.day : game.executionHistory.length;
  const used = usedClaimDays(game, playerId, claimedRole);
  return Array.from({ length: maxDay }, (_, index) => index + 1).filter(
    (day) => !used.has(day),
  );
}

export function remainingClaimSlots(
  game: GameState,
  playerId: string,
  claimedRole: "占い師" | "霊能者",
): number {
  return availableClaimDays(game, playerId, claimedRole).length;
}

export function npcFakeSeerClaimDays(
  game: GameState,
  npcId: string,
  isContinuingClaim: boolean,
): number[] {
  const availableDays = availableClaimDays(game, npcId, "占い師");
  return isContinuingClaim ? availableDays.slice(0, 1) : availableDays;
}

export function applyPublicClaimSuspicion(
  game: GameState,
  target: Player,
  result: PublicResult,
): void {
  if (!target.alive) return;
  addPublicClaimSuspicion(game.npcSuspicion, target.id, result);
}

function hasNpcClaimedRole(
  game: GameState,
  npcId: string,
  claimedRole: "占い師" | "霊能者",
): boolean {
  return claimedRoleForPlayer(game, npcId) === claimedRole;
}

export function npcDiscussionSpeakers(
  game: GameState,
  maxOrdinarySpeakers: number,
): Player[] {
  const livingNpcs = alivePlayers(game).filter((player) => player.isNpc);
  const priority = livingNpcs.filter(
    (npc) =>
      npc.role === "占い師" ||
      (npc.role === "霊能者" && Boolean(game.lastExecuted)) ||
      hasNpcClaimedRole(game, npc.id, "占い師") ||
      hasNpcClaimedRole(game, npc.id, "霊能者") ||
      npcSeerClaimPlanStartsOnDay(game.npcSeerClaimPlans.get(npc.id), game.day),
  );
  const selectedPriority = shuffle(priority);
  const priorityIds = new Set(priority.map((npc) => npc.id));
  const others = shuffle(
    livingNpcs.filter((npc) => !priorityIds.has(npc.id)),
  ).slice(0, Math.max(0, maxOrdinarySpeakers));
  return [...selectedPriority, ...others];
}

export function nextNpcSeerTarget(
  game: GameState,
  seer: Player,
): Player | undefined {
  const targets = alivePlayers(game).filter((player) => player.id !== seer.id);
  const inspectedIds = new Set(
    (game.seerResults.get(seer.id) ?? []).map((result) => result.targetId),
  );
  const uninspected = targets.filter((target) => !inspectedIds.has(target.id));
  const candidates = uninspected.length ? uninspected : targets;
  return candidates.length ? randomItem(candidates) : undefined;
}

export function roleClaimLine(
  speaker: Player,
  claimedRole: "占い師" | "霊能者",
  target: Player,
  result: PublicResult,
  resultDay?: number,
): string {
  const icon = claimedRole === "占い師" ? "🔮" : "👻";
  const dayLabel = resultDay ? `**${resultDay}日目**｜` : "";
  return `**${safeName(speaker)}**（${speaker.isNpc ? "NPC" : "プレイヤー"}）　${icon} ${claimedRole}CO：${dayLabel}**${safeName(target)}** は **${result}**`;
}

function roleRetractionLine(speaker: Player, claimedRole: ClaimedRole): string {
  return `**${safeName(speaker)}**（${speaker.isNpc ? "NPC" : "プレイヤー"}）　↩️ ${claimedRole}COを取り消しました。これまでの判定は無効です。`;
}

export function roleDeclarationLine(
  speaker: Player,
  claimedRole: "騎士",
): string {
  return `**${safeName(speaker)}**（${speaker.isNpc ? "NPC" : "プレイヤー"}）　🛡️ ${claimedRole}CO`;
}

function publicPlayerLabel(player: Player): string {
  return `**${safeName(player)}**（${player.isNpc ? "NPC" : "プレイヤー"}）`;
}

function chunkedClaimFields(name: string, lines: string[]) {
  if (lines.length === 0) return [{ name, value: "—" }];
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > 900 && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((value, index) => ({
    name: index === 0 ? name : `${name}（続き）`,
    value,
  }));
}

function resultClaimRows(
  game: GameState,
  claimedRole: "占い師" | "霊能者",
): string[] {
  const claims = game.npcClaims
    .filter((claim) => claim.claimedRole === claimedRole)
    .slice(-30);
  const bySpeaker = new Map<string, typeof claims>();
  for (const claim of claims) {
    const entries = bySpeaker.get(claim.speakerId) ?? [];
    entries.push(claim);
    bySpeaker.set(claim.speakerId, entries);
  }
  return [...bySpeaker.entries()].flatMap(([speakerId, entries]) => {
    const speaker = game.players.find((player) => player.id === speakerId);
    if (!speaker) return [];
    const results = entries.flatMap((claim, index) => {
      const target = game.players.find(
        (player) => player.id === claim.targetId,
      );
      if (!target) return [];
      const resultDay = claim.resultDay ?? index + 1;
      return `${resultDay}日目 **${safeName(target)}** ${claim.result === "人狼" ? "●" : "○"}`;
    });
    return results.length
      ? [`${publicPlayerLabel(speaker)}　${results.join("｜")}`]
      : [];
  });
}

function guardClaimRows(game: GameState): string[] {
  return [...game.roleDeclarations].slice(-30).flatMap((declaration) => {
    const [dayText, speakerId, claimedRole] = declaration.split(":");
    if (claimedRole !== "騎士") return [];
    const speaker = game.players.find((player) => player.id === speakerId);
    return speaker ? [`${dayText}日目　${publicPlayerLabel(speaker)}`] : [];
  });
}

function hasCorroboratedSeerResult(game: GameState): boolean {
  if (conflictingSeerClaimantIds(game.npcClaims).size > 0) return false;
  const claimantsByResult = new Map<string, Set<string>>();
  for (const claim of game.npcClaims) {
    if (claim.claimedRole !== "占い師") continue;
    const key = `${claim.targetId}:${claim.result}`;
    const claimants = claimantsByResult.get(key) ?? new Set<string>();
    claimants.add(claim.speakerId);
    claimantsByResult.set(key, claimants);
  }
  return [...claimantsByResult.values()].some(
    (claimants) => claimants.size >= 2,
  );
}

function resultClaimFieldName(
  game: GameState,
  role: "占い師" | "霊能者",
): string {
  const icon = role === "占い師" ? "🔮" : "👻";
  const claimantCount = roleClaimantIds(game.npcClaims, role).size;
  const capacity = game.roleConfig[role];
  const states: string[] = [];
  if (isRoleClaimOverCapacity(game, role)) states.push("配役超過");
  if (role === "占い師") {
    if (conflictingSeerClaimantIds(game.npcClaims).size > 0)
      states.push("判定割れ");
    else if (hasCorroboratedSeerResult(game)) states.push("一致判定あり");
  }
  const stateLabel = states.length > 0 ? `・${states.join("・")}` : "";
  return `${icon} ${role}CO｜${claimantCount}/${capacity}人${stateLabel}`;
}

export function claimListEmbed(
  game: GameState,
  visibleSpeakerIds?: ReadonlySet<string>,
): EmbedBuilder {
  const visibleGame: GameState = visibleSpeakerIds
    ? {
        ...game,
        npcClaims: game.npcClaims.filter((claim) =>
          visibleSpeakerIds.has(claim.speakerId),
        ),
        roleDeclarations: new Set(
          [...game.roleDeclarations].filter((declaration) =>
            visibleSpeakerIds.has(declaration.split(":")[1]),
          ),
        ),
      }
    : game;
  return new EmbedBuilder()
    .setTitle(`CO・判定一覧｜${game.day}日目`)
    .setDescription(
      `${visibleSpeakerIds ? "現在の分断部屋で" : ""}公開中のCOを配役人数と比較しています。枠内のCOも本物とは限りません。取り消されたCOは表示されません。`,
    )
    .addFields(
      ...chunkedClaimFields(
        resultClaimFieldName(visibleGame, "占い師"),
        resultClaimRows(visibleGame, "占い師"),
      ),
      ...chunkedClaimFields(
        resultClaimFieldName(visibleGame, "霊能者"),
        resultClaimRows(visibleGame, "霊能者"),
      ),
      ...chunkedClaimFields("🛡️ 騎士CO", guardClaimRows(visibleGame)),
    )
    .setColor(COLORS.day)
    .setFooter({ text: "● 人狼判定　○ 人間判定（各欄は直近30件）" });
}

function progressBar(done: number, total: number): string {
  const size = 8;
  const filled = total > 0 ? Math.round((done / total) * size) : 0;
  return `${"▰".repeat(filled)}${"▱".repeat(size - filled)}`;
}

function playerNameRows(players: Player[]): string {
  return players
    .map((player) => `${player.isNpc ? "🤖" : "👤"} ${safeName(player)}`)
    .join("　");
}

function roleRows(players: Player[]): string {
  if (players.length === 0) return "—";
  return players
    .map(
      (player) =>
        `**${safeName(player)}**　${ROLE_INFO[player.role as RoleName].icon} ${player.role}`,
    )
    .join("\n");
}

function configuredRoles(game: GameState): RoleName[] {
  return ROLE_NAMES.flatMap((role) =>
    Array<RoleName>(game.roleConfig[role]).fill(role),
  );
}

function roleConfigRows(game: GameState): string {
  const config = game.roleConfig;
  const visible = ROLE_NAMES.filter(
    (role) => role === "村人" || config[role] > 0,
  ).map((role) => `${ROLE_INFO[role].icon} ${role} **${config[role]}**`);
  const rows: string[] = [];
  for (let index = 0; index < visible.length; index += 2) {
    rows.push(visible.slice(index, index + 2).join("　　"));
  }
  return rows.join("\n");
}

function mentionRows(players: Player[]): string {
  return players.map((player) => `<@${player.id}>`).join("\n") || "—";
}

export function dayEmbed(
  game: GameState,
  visibleGroup?: "A" | "B",
): EmbedBuilder {
  const living = alivePlayers(game);
  const visibleLiving = visibleGroup
    ? living.filter(
        (player) => game.divisionGroups?.get(player.id) === visibleGroup,
      )
    : living;
  const bakerExists = game.roleConfig.パン屋 > 0;
  const bakerAlive = living.some((player) => player.role === "パン屋");
  const breadLine = bakerExists
    ? bakerAlive
      ? "\n\n🥐 今朝も焼きたてのパンが届きました。"
      : "\n\n🥐 今朝はパンが届きませんでした。"
    : "";
  const openingDeathLine =
    game.day === 1 && (game.openingDeathIds?.length ?? 0) > 0
      ? `\n\n🦊 夜明け前、${game.openingDeathIds
          ?.map((id) => game.players.find((player) => player.id === id))
          .filter((player): player is Player => Boolean(player))
          .map((player) => `**${safeName(player)}**`)
          .join("、")} が占われて死亡しました。`
      : "";
  const embed = new EmbedBuilder()
    .setTitle(`${game.day}日目｜議論`)
    .setDescription(
      `話し合って、投票先を決めよう。\n\n投票開始：${relativeTime(game.phaseEndsAt)}${openingDeathLine}${breadLine}`,
    )
    .addFields({
      name: visibleGroup
        ? `${visibleGroup}組（${visibleLiving.length}人）`
        : `生存者（${living.length}人）`,
      value: playerNameRows(visibleLiving),
    })
    .setColor(COLORS.day);
  if (!visibleGroup && game.divisionGroups && game.divisionGroups.size > 0) {
    for (const group of ["A", "B"] as const) {
      const members = living.filter(
        (player) => game.divisionGroups?.get(player.id) === group,
      );
      embed.addFields({
        name: `分断議論｜${group}組`,
        value: playerNameRows(members) || "—",
      });
    }
  }
  return embed;
}

export function finishedDayEmbed(game: GameState): EmbedBuilder {
  const living = alivePlayers(game);
  return new EmbedBuilder()
    .setTitle(`${game.day}日目｜議論終了`)
    .setDescription("議論を終了しました。")
    .addFields({
      name: `生存者（${living.length}人）`,
      value: playerNameRows(living),
    })
    .setColor(COLORS.day);
}

export function voteEmbed(game: GameState): EmbedBuilder {
  const done = game.votes.size;
  const total = alivePlayers(game).length;
  const title = game.voteRound > 1 ? "再投票" : "投票";
  return new EmbedBuilder()
    .setTitle(`${game.day}日目｜${title}`)
    .setDescription(
      `投票済み　**${done} / ${total}**\n${progressBar(done, total)}\n\n投票終了：${relativeTime(game.phaseEndsAt)}`,
    )
    .setColor(COLORS.vote)
    .setFooter({
      text: "自分以外へ投票。結果発表までは非公開で、締切前なら変更できます",
    });
}

export function nightEmbed(game: GameState): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${game.day}日目｜夜`)
    .setDescription(
      `能力者はDMを確認してください。\n全員の行動が終わると、夜が明けます。\n\n夜明け：${relativeTime(game.phaseEndsAt)}`,
    )
    .setColor(COLORS.night);
}

function createNpc(game: GameState): Player {
  let serial = 1;
  while (
    game.players.some(
      (player) => player.id === `npc-${game.channelId}-${serial}`,
    )
  )
    serial += 1;
  const unusedName = NPC_NAMES.find(
    (name) => !game.players.some((player) => player.name === name),
  );
  return {
    id: `npc-${game.channelId}-${serial}`,
    name: unusedName ?? `NPC${serial}`,
    user: null,
    isNpc: true,
    npcPersonality: personalityForSerial(serial),
    alive: true,
  };
}

function addNpc(game: GameState): boolean {
  if (game.players.length >= MAX_PLAYERS) return false;
  game.players.push(createNpc(game));
  return true;
}

function playerOptions(players: Player[]) {
  return players.map((player) => ({
    label: player.name.slice(0, 100),
    value: player.id,
  }));
}

export function lobbyPayload(game: GameState) {
  const humans = game.players.filter((player) => !player.isNpc);
  const humanCount = humans.length;
  const npcCount = Math.max(0, game.targetPlayerCount - humanCount);
  const host = game.players.find((player) => player.id === game.hostId);
  const failedPlayers = humans.filter((player) =>
    game.roleDmFailures.has(player.id),
  );

  if (failedPlayers.length > 0) {
    const embed = new EmbedBuilder()
      .setTitle("ゲーム開始｜DM待機")
      .setDescription(
        `次の参加者に役職DMを送れませんでした。\n${failedPlayers
          .map((player) => `<@${player.id}>`)
          .join("\n")}\n\nDMを受け取れる設定にしてから再送してください。`,
      )
      .setColor(COLORS.danger)
      .setFooter({ text: "配役は固定されたままです" });
    const retryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("start", game))
        .setLabel("DMを再送")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(componentId("cancel", game))
        .setLabel("募集を中止")
        .setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [retryRow] };
  }

  const embed = new EmbedBuilder()
    .setTitle("人狼ゲーム｜参加受付")
    .setDescription(
      `**参加者（${humanCount}/${game.targetPlayerCount}）**\n${mentionRows(humans)}`,
    )
    .addFields(
      {
        name: "ゲーム設定",
        value: `プレイ人数：${game.targetPlayerCount}人\nNPC予定：${npcCount}人\n議論時間：${discussionSecondsForGame(game, game.targetPlayerCount, humanCount)}秒`,
      },
      {
        name: "配役",
        value: roleConfigRows(game),
      },
    );
  embed.setColor(COLORS.lobby).setFooter({
    text: `ホスト：${host ? safeName(host) : "不明"}／不足分はNPCで補充`,
  });

  const countMenu = new StringSelectMenuBuilder()
    .setCustomId(componentId("player-count", game))
    .setPlaceholder(`プレイ人数：${game.targetPlayerCount}人`)
    .addOptions(
      Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => {
        const count = MIN_PLAYERS + index;
        return {
          label: `${count}人`,
          value: String(count),
          default: count === game.targetPlayerCount,
        };
      }),
    );
  const countRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(countMenu);
  const participantRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId("join", game))
      .setLabel("参加する")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(humanCount >= game.targetPlayerCount),
    new ButtonBuilder()
      .setCustomId(componentId("leave", game))
      .setLabel("退出する")
      .setStyle(ButtonStyle.Secondary),
  );
  const hostButtons = [
    new ButtonBuilder()
      .setCustomId(componentId("role-config", game))
      .setLabel("配役を設定")
      .setStyle(ButtonStyle.Secondary),
  ];
  hostButtons.push(
    new ButtonBuilder()
      .setCustomId(componentId("start", game))
      .setLabel("ゲーム開始")
      .setStyle(ButtonStyle.Success)
      .setDisabled(humanCount === 0),
    new ButtonBuilder()
      .setCustomId(componentId("cancel", game))
      .setLabel("募集を中止")
      .setStyle(ButtonStyle.Danger),
  );
  const hostRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    hostButtons,
  );

  return {
    embeds: [embed],
    components: [countRow, participantRow, hostRow],
  };
}

export function recommendedLobbyRoleConfig(
  playerCount: number,
  humanCount: number,
) {
  if (humanCount < 1) {
    throw new Error("人間プレイヤーは1人以上必要です。");
  }
  return roleConfigFromRoles(
    humanCount === 1 ? buildSoloRoles(playerCount) : buildRoles(playerCount),
  );
}

function sameRoleConfig(
  left: GameState["roleConfig"],
  right: GameState["roleConfig"],
): boolean {
  return ROLE_NAMES.every((role) => left[role] === right[role]);
}

export function syncRecommendedLobbyRoleConfig(
  game: Pick<GameState, "players" | "roleConfig" | "targetPlayerCount">,
  previousPlayerCount: number,
  previousHumanCount: number,
): boolean {
  const previousRecommended = recommendedLobbyRoleConfig(
    previousPlayerCount,
    previousHumanCount,
  );
  if (!sameRoleConfig(game.roleConfig, previousRecommended)) return false;

  const humanCount = game.players.filter((player) => !player.isNpc).length;
  game.roleConfig = recommendedLobbyRoleConfig(
    game.targetPlayerCount,
    humanCount,
  );
  return true;
}

export interface CreateLobbyOptions {
  participants?: User[];
  targetPlayerCount?: number;
}

async function replyLobbyError(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({ content, embeds: [], components: [] });
    return;
  }
  if (interaction.replied) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }
  await interaction.reply({ content, ephemeral: true });
}

export async function createLobby(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  options: CreateLobbyOptions = {},
): Promise<void> {
  if (
    !interaction.inGuild() ||
    interaction.channel?.type !== ChannelType.GuildText
  ) {
    await replyLobbyError(
      interaction,
      "サーバーのテキストチャンネルで実行してください。",
    );
    return;
  }

  const existing = gameForChannelId(interaction.channelId);
  if (existing?.phase === "ended") {
    clearGameTimers(existing);
    games.delete(existing.channelId);
    void existing.phaseMessage?.edit({ components: [] }).catch(() => undefined);
    void disableFeedbackPanel(existing);
  } else if (existing) {
    await replyLobbyError(
      interaction,
      "このチャンネルでは既にゲームが進行中です。",
    );
    return;
  }

  const participantUsers = [
    interaction.user,
    ...(options.participants ?? []),
  ].filter(
    (user, index, users) =>
      !user.bot &&
      users.findIndex((candidate) => candidate.id === user.id) === index,
  );
  if (participantUsers.length > MAX_PLAYERS) {
    await replyLobbyError(
      interaction,
      `参加者が${MAX_PLAYERS}人を超えています。Discordイベントの「興味あり」を${MAX_PLAYERS}人以下にしてから、もう一度開始してください。`,
    );
    return;
  }

  const requestedTarget = options.targetPlayerCount ?? SOLO_PLAYER_COUNT;
  const targetPlayerCount = Math.min(
    MAX_PLAYERS,
    Math.max(MIN_PLAYERS, requestedTarget, participantUsers.length),
  );
  const analyticsSessionId = randomUUID();
  const game: GameState = {
    channelId: interaction.channelId,
    channel: interaction.channel as TextChannel,
    hostId: interaction.user.id,
    phase: "lobby",
    players: participantUsers.map((user) => ({
      id: user.id,
      name: user.displayName,
      user,
      isNpc: false,
      alive: true,
    })),
    targetPlayerCount,
    roleConfig: recommendedLobbyRoleConfig(
      targetPlayerCount,
      participantUsers.length,
    ),
    roleDmSent: new Set(),
    roleDmFailures: new Set(),
    pendingDmMessages: new Map(),
    day: 0,
    voteRound: 1,
    voteCandidateIds: [],
    votes: new Map(),
    voteHistory: [],
    nightChoices: new Map(),
    npcSuspicion: new Map(),
    npcMemory: new Map(),
    npcClaims: [],
    claimHistory: [],
    npcSeerClaimPlans: new Map(),
    roleDeclarations: new Set(),
    humanSuspicions: new Map(),
    npcQuestionCounts: new Map(),
    seerResults: new Map(),
    openingDeathIds: [],
    executionHistory: [],
    nightHistory: [],
    postgameRecapState: "idle",
    wolfChatCounts: new Map(),
    loverPairs: [],
    devoteeTargets: new Map(),
    usedRolePowers: new Set(),
    fatalWoundIds: new Set(),
    divisionGroups: new Map(),
    loquaciousMissions: new Map(),
    loquaciousCompleted: new Set(),
    timers: [],
    resolving: false,
    resolutionQueued: false,
    analyticsSessionId,
    analyticsChainId: analyticsSessionId,
    analyticsFeedbackPromptShown: false,
    analyticsFeedbackEligibleUserIds: new Set(),
    analyticsFeedbackSubmittedUserIds: new Set(),
    analyticsFeedbackSubmittingUserIds: new Set(),
    starting: false,
  };

  games.set(game.channelId, game);
  let responseStarted = Boolean(interaction.deferred || interaction.replied);
  try {
    let lobbyMessage: Message;
    if (responseStarted) {
      lobbyMessage = (await interaction.followUp(
        lobbyPayload(game),
      )) as Message;
      if (interaction.deferred) {
        await interaction
          .editReply({
            content: `ロビーを作成しました。参加者：${participantUsers.length}人`,
            embeds: [],
            components: [],
          })
          .catch(() => undefined);
      }
    } else {
      await interaction.reply(lobbyPayload(game));
      responseStarted = true;
      lobbyMessage = (await interaction.fetchReply()) as Message;
    }
    if (!isActiveGame(game)) {
      await lobbyMessage
        .edit({
          content: "この募集は終了しました。",
          embeds: [],
          components: [],
        })
        .catch(() => undefined);
      return;
    }
    game.lobbyMessage = lobbyMessage;
    const analytics = analyticsSnapshot(game);
    queueAnalytics(game, () => recordLobbyOpened(analytics));
  } catch (error) {
    if (isActiveGame(game)) {
      clearGameTimers(game);
      games.delete(game.channelId);
    }
    const failure =
      "募集画面を準備できなかったため、この募集を終了しました。もう一度 `/jinro` を実行してください。";
    if (responseStarted) {
      await interaction
        .editReply({ content: failure, embeds: [], components: [] })
        .catch(() => undefined);
    } else {
      await interaction
        .reply({ content: failure, ephemeral: true })
        .catch(() => undefined);
    }
    console.error("Lobby creation failed:", error);
  }
}

async function disableFeedbackPanel(game: GameState): Promise<void> {
  if (!game.analyticsFeedbackMessageId) return;
  await game.channel.messages
    .fetch(game.analyticsFeedbackMessageId)
    .then((message) => message.edit({ components: [] }))
    .catch(() => undefined);
}

export interface ResetChannelResult {
  status: "reset" | "not_found" | "forbidden";
  components: Array<ActionRowBuilder<ButtonBuilder>>;
}

export interface ResetChannelRequester {
  userId: string;
  canManageMessages: boolean;
  collectReason?: boolean;
}

export function canResetGame(
  game: Pick<GameState, "hostId">,
  requester: Pick<ResetChannelRequester, "userId" | "canManageMessages">,
): boolean {
  return game.hostId === requester.userId || requester.canManageMessages;
}

export function shouldOfferAbandonReason(
  game: Pick<GameState, "phase" | "analyticsStartedAt" | "analyticsCompleted">,
): boolean {
  return Boolean(
    game.analyticsStartedAt &&
    !game.analyticsCompleted &&
    game.phase !== "ended",
  );
}

function registerPendingAbandonReason(
  game: GameState,
  userId: string,
): Array<ActionRowBuilder<ButtonBuilder>> {
  const sessionId = analyticsSnapshot(game).sessionId;
  const pending: PendingAbandonReason = {
    channelId: game.channelId,
    sessionId,
    userId,
    expiresAt: Date.now() + ABANDON_REASON_WINDOW_MS,
    analyticsReady: game.analyticsPending ?? Promise.resolve(),
    submitting: false,
  };
  pendingAbandonReasons.set(sessionId, pending);
  const expiration = setTimeout(() => {
    if (pendingAbandonReasons.get(sessionId) === pending) {
      pendingAbandonReasons.delete(sessionId);
    }
  }, ABANDON_REASON_WINDOW_MS);
  expiration.unref();
  return abandonReasonRows(game.channelId, sessionId);
}

export async function resetChannel(
  channelId: string,
  editMessage = true,
  requester?: ResetChannelRequester,
): Promise<ResetChannelResult> {
  const game = gameForChannelId(channelId);
  if (!game) return { status: "not_found", components: [] };
  if (requester && !canResetGame(game, requester)) {
    return { status: "forbidden", components: [] };
  }
  const wasInProgress = Boolean(
    game.analyticsStartedAt && game.phase !== "ended",
  );
  clearGameTimers(game);
  await restoreDivisionChannels(game, "ゲーム終了による分断解除").catch(
    (error) => console.error("Division cleanup during reset failed:", error),
  );
  let abandonReasonComponents: Array<ActionRowBuilder<ButtonBuilder>> = [];
  if (game.phase !== "ended" && !game.analyticsCompleted) {
    const durationSeconds = playedSeconds(game);
    const analytics = {
      ...analyticsSnapshot(game),
      status: game.analyticsStartedAt
        ? ("reset" as const)
        : ("cancelled" as const),
      dayCount: game.analyticsStartedAt ? game.day : 0,
      durationSeconds,
      abandonPhase: analyticsAbandonPhase(game),
      startedAt: game.analyticsStartedAt
        ? new Date(game.analyticsStartedAt).toISOString()
        : undefined,
    };
    queueAnalytics(game, () => recordGameAbandoned(analytics));
    if (
      requester?.collectReason &&
      requester.userId &&
      shouldOfferAbandonReason(game)
    ) {
      abandonReasonComponents = registerPendingAbandonReason(
        game,
        requester.userId,
      );
    }
  }
  // 実行待ちの処理が中断後に発言・DM・フェーズ更新を続けないよう、
  // マップから外す前に進行不能な状態へ切り替える。
  game.phase = "ended";
  game.resolving = true;
  game.resolutionQueued = false;
  game.starting = false;
  games.delete(game.channelId);
  await disableFeedbackPanel(game);
  if (editMessage) {
    if (!wasInProgress) {
      await game.lobbyMessage
        ?.edit({
          content: "ゲームはリセットされました。",
          embeds: [],
          components: [],
        })
        .catch(() => undefined);
    }
    if (game.phaseMessage && game.phaseMessage.id !== game.lobbyMessage?.id) {
      await game.phaseMessage.edit({ components: [] }).catch(() => undefined);
    }
    if (wasInProgress) {
      await game.channel
        .send({ embeds: [interruptedGameEmbed(game)] })
        .catch((error) => {
          console.error("Game interruption notice failed:", error);
        });
    }
  }
  return {
    status: "reset",
    components: abandonReasonComponents,
  };
}

async function handleAbandonReasonButton(
  interaction: ButtonInteraction,
  channelId: string,
  sessionId: string,
  reason: AbandonReason,
): Promise<void> {
  const pending = pendingAbandonReasons.get(sessionId);
  if (
    !pending ||
    pending.channelId !== channelId ||
    pending.expiresAt <= Date.now()
  ) {
    pendingAbandonReasons.delete(sessionId);
    await interaction.reply({
      content: "この回答受付は終了しました。",
      ephemeral: true,
    });
    return;
  }
  if (pending.userId !== interaction.user.id) {
    await interaction.reply({
      content: "ゲームを終了した本人だけが回答できます。",
      ephemeral: true,
    });
    return;
  }
  if (pending.submitting) {
    await interaction.reply({
      content: "回答を保存しています。",
      ephemeral: true,
    });
    return;
  }

  pending.submitting = true;
  await interaction.deferUpdate();
  await pending.analyticsReady;
  const result = await recordAbandonReason({ sessionId, reason });
  if (result.status === "saved") {
    pendingAbandonReasons.delete(sessionId);
    await interaction.editReply({
      content: "回答ありがとう！ 次の改善に使います。",
      components: [],
    });
    return;
  }
  if (result.status === "disabled") {
    pendingAbandonReasons.delete(sessionId);
    await interaction.editReply({
      content: "回答ありがとう！ 現在は集計が無効のため保存されませんでした。",
      components: [],
    });
    return;
  }

  pending.submitting = false;
  await interaction.editReply({
    content: "回答を保存できませんでした。少し待って、もう一度選んでください。",
    components: abandonReasonRows(channelId, sessionId),
  });
}

async function updateLobby(game: GameState): Promise<void> {
  if (!isActiveGame(game)) return;
  const message = game.lobbyMessage;
  await message?.edit(lobbyPayload(game));
  if (!isActiveGame(game)) {
    await message
      ?.edit({
        content: "この募集は終了しました。",
        embeds: [],
        components: [],
      })
      .catch(() => undefined);
  }
}

function lobbyConfigurationLocked(game: GameState): boolean {
  return Boolean(
    game.starting ||
    game.analyticsStartedAt !== undefined ||
    game.roleDmSent.size > 0 ||
    game.roleDmFailures.size > 0,
  );
}

async function handleJoin(
  interaction: ButtonInteraction,
  game: GameState,
  action: "join" | "leave",
): Promise<void> {
  if (game.phase !== "lobby" || lobbyConfigurationLocked(game)) {
    await interaction.reply({
      content: "募集は終了しています。",
      ephemeral: true,
    });
    return;
  }

  const previousHumanCount = game.players.filter(
    (player) => !player.isNpc,
  ).length;
  const index = game.players.findIndex(
    (player) => player.id === interaction.user.id,
  );
  if (action === "leave") {
    if (index < 0) {
      await interaction.reply({
        content: "現在このゲームには参加していません。",
        ephemeral: true,
      });
      return;
    }
    if (interaction.user.id === game.hostId) {
      await interaction.reply({
        content: "ホストは退出できません。募集を中止してください。",
        ephemeral: true,
      });
      return;
    }
    game.players.splice(index, 1);
  } else {
    if (index >= 0) {
      await interaction.reply({
        content: "すでに参加しています。",
        ephemeral: true,
      });
      return;
    }
    const humanCount = game.players.filter((player) => !player.isNpc).length;
    if (humanCount >= game.targetPlayerCount) {
      await interaction.reply({
        content: `このゲームは${game.targetPlayerCount}人設定です。`,
        ephemeral: true,
      });
      return;
    }
    game.players.push({
      id: interaction.user.id,
      name: interaction.user.displayName,
      user: interaction.user,
      isNpc: false,
      alive: true,
    });
  }

  syncRecommendedLobbyRoleConfig(
    game,
    game.targetPlayerCount,
    previousHumanCount,
  );

  await interaction.deferUpdate();
  await updateLobby(game);
}

async function handlePlayerCountChange(
  interaction: StringSelectMenuInteraction,
  game: GameState,
): Promise<void> {
  if (interaction.user.id !== game.hostId) {
    await interaction.reply({
      content: "プレイ人数を変更できるのはホストだけです。",
      ephemeral: true,
    });
    return;
  }
  if (game.phase !== "lobby" || lobbyConfigurationLocked(game)) {
    await interaction.reply({
      content: "ゲーム開始後は人数を変更できません。",
      ephemeral: true,
    });
    return;
  }

  const count = Number(interaction.values[0]);
  const humans = game.players.filter((player) => !player.isNpc);
  if (!Number.isInteger(count) || count < MIN_PLAYERS || count > MAX_PLAYERS) {
    await interaction.reply({
      content: "プレイ人数は4〜15人から選んでください。",
      ephemeral: true,
    });
    return;
  }
  if (count < humans.length) {
    await interaction.reply({
      content: `現在${humans.length}人が参加中のため、それ未満にはできません。`,
      ephemeral: true,
    });
    return;
  }

  const previousPlayerCount = game.targetPlayerCount;
  game.players = humans;
  game.targetPlayerCount = count;
  let configWasReset = false;
  if (
    !syncRecommendedLobbyRoleConfig(game, previousPlayerCount, humans.length)
  ) {
    try {
      game.roleConfig = roleConfigFromRoles(
        buildCustomRoles(count, configurableRoleCounts(game.roleConfig), {
          unrestricted: isBetaTester(game.hostId),
        }),
      );
    } catch {
      game.roleConfig = recommendedLobbyRoleConfig(count, humans.length);
      configWasReset = true;
    }
  }
  await interaction.deferUpdate();
  await updateLobby(game);
  if (configWasReset) {
    await interaction.followUp({
      content:
        "新しい人数では元の配役が成立しないため、配役を標準構成に戻しました。",
      ephemeral: true,
    });
  }
}

type ConfigurableRole = Exclude<RoleName, "村人">;

function configurableRoleCounts(
  config: GameState["roleConfig"],
): Partial<Omit<GameState["roleConfig"], "村人">> &
  Pick<GameState["roleConfig"], "人狼"> {
  return Object.fromEntries(
    CONFIGURABLE_ROLE_NAMES.map((role) => [role, config[role]]),
  ) as Partial<Omit<GameState["roleConfig"], "村人">> &
    Pick<GameState["roleConfig"], "人狼">;
}

function configurableRoleToken(role: ConfigurableRole): string {
  return CONFIGURABLE_ROLE_NAMES.indexOf(role).toString(36);
}

function roleFromConfigurableToken(
  token: string,
): ConfigurableRole | undefined {
  const index = Number.parseInt(token, 36);
  return CONFIGURABLE_ROLE_NAMES[index] as ConfigurableRole | undefined;
}

function roleCountStep(role: ConfigurableRole): number {
  return role === "共有者" ? 2 : 1;
}

export function usesUnrankedRoleConfig(
  game: Pick<GameState, "roleConfig">,
): boolean {
  return usesUnrestrictedRoleConfig(game.roleConfig);
}

function canUseRoleCount(
  game: GameState,
  role: ConfigurableRole,
  count: number,
): boolean {
  const proposed = configurableRoleCounts(game.roleConfig);
  proposed[role] = count;
  try {
    buildCustomRoles(game.targetPlayerCount, proposed, {
      unrestricted: isBetaTester(game.hostId),
    });
    return true;
  } catch {
    return false;
  }
}

export function roleConfigPanel(
  game: GameState,
  selectedRole: ConfigurableRole = "人狼",
) {
  const betaTester = isBetaTester(game.hostId);
  const embed = new EmbedBuilder()
    .setTitle(`配役設定｜${game.targetPlayerCount}人`)
    .setDescription(
      betaTester
        ? "βテスター自由配役｜共有者は2人単位ですが、各役職の個別上限はありません。自由配役は戦績対象外です。"
        : "役職を選び、人数を調整してください。追加役職を使う試合は戦績対象外です。",
    )
    .addFields(
      { name: "現在の配役", value: roleConfigRows(game) },
      {
        name: `${ROLE_INFO[selectedRole].icon} ${selectedRole}`,
        value: ROLE_INFO[selectedRole].description,
      },
    )
    .setColor(COLORS.lobby)
    .setFooter({ text: "村人は残り人数から自動計算されます" });

  const selector =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(componentId("role-config-select", game))
        .setPlaceholder("変更する役職を選ぶ")
        .addOptions(
          CONFIGURABLE_ROLE_NAMES.map((role) => ({
            label: `${ROLE_INFO[role].icon} ${role}`,
            description: `${ROLE_INFO[role].description.slice(0, 82)} (${game.roleConfig[role]}人)`,
            value: configurableRoleToken(role as ConfigurableRole),
            default: role === selectedRole,
          })),
        ),
    );
  const current = game.roleConfig[selectedRole];
  const step = roleCountStep(selectedRole);
  const adjust = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        componentId(
          `role-decrease-${configurableRoleToken(selectedRole)}`,
          game,
        ),
      )
      .setLabel("−")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canUseRoleCount(game, selectedRole, current - step)),
    new ButtonBuilder()
      .setCustomId(
        componentId(
          `role-current-${configurableRoleToken(selectedRole)}`,
          game,
        ),
      )
      .setLabel(`${ROLE_INFO[selectedRole].icon} ${selectedRole} ${current}人`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(
        componentId(
          `role-increase-${configurableRoleToken(selectedRole)}`,
          game,
        ),
      )
      .setLabel("＋")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canUseRoleCount(game, selectedRole, current + step)),
  );
  return { content: "", embeds: [embed], components: [selector, adjust] };
}

async function handleRoleConfigSelect(
  interaction: StringSelectMenuInteraction,
  game: GameState,
): Promise<void> {
  if (
    interaction.user.id !== game.hostId ||
    game.phase !== "lobby" ||
    lobbyConfigurationLocked(game)
  ) {
    await interaction.reply({
      content: "現在は配役を変更できません。",
      ephemeral: true,
    });
    return;
  }
  const role = roleFromConfigurableToken(interaction.values[0]);
  if (!role) {
    await interaction.reply({
      content: "役職を選び直してください。",
      ephemeral: true,
    });
    return;
  }
  await interaction.update(roleConfigPanel(game, role));
}

async function handleRoleConfigButton(
  interaction: ButtonInteraction,
  game: GameState,
): Promise<void> {
  if (interaction.user.id !== game.hostId) {
    await interaction.reply({
      content: "配役を変更できるのはホストだけです。",
      ephemeral: true,
    });
    return;
  }
  if (game.phase !== "lobby" || lobbyConfigurationLocked(game)) {
    await interaction.reply({
      content: "ゲーム開始後は配役を変更できません。",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ ...roleConfigPanel(game), ephemeral: true });
}

async function handleRoleConfigAdjust(
  interaction: ButtonInteraction,
  game: GameState,
  action: string,
): Promise<void> {
  if (
    interaction.user.id !== game.hostId ||
    game.phase !== "lobby" ||
    lobbyConfigurationLocked(game)
  ) {
    await interaction.reply({
      content: "現在は配役を変更できません。",
      ephemeral: true,
    });
    return;
  }

  const match = /^role-(decrease|increase)-([0-9a-z]+)$/.exec(action);
  const configRole = roleFromConfigurableToken(match?.[2] ?? "");
  if (!match || !configRole) {
    await interaction.reply({
      content: "その設定は変更できません。",
      ephemeral: true,
    });
    return;
  }

  const step = roleCountStep(configRole);
  const nextCount =
    game.roleConfig[configRole] + (match[1] === "increase" ? step : -step);
  try {
    const proposed = configurableRoleCounts(game.roleConfig);
    proposed[configRole] = nextCount;
    const roles = buildCustomRoles(game.targetPlayerCount, proposed, {
      unrestricted: isBetaTester(game.hostId),
    });
    game.roleConfig = roleConfigFromRoles(roles);
  } catch (error) {
    await interaction.reply({
      content:
        error instanceof Error ? error.message : "配役を確認してください。",
      ephemeral: true,
    });
    return;
  }

  await interaction.update(roleConfigPanel(game, configRole));
  await updateLobby(game);
}

async function handleStart(
  interaction: ButtonInteraction,
  game: GameState,
): Promise<void> {
  if (interaction.user.id !== game.hostId) {
    await interaction.reply({
      content: "ゲームを開始できるのは主催者だけです。",
      ephemeral: true,
    });
    return;
  }
  if (game.phase !== "lobby" || game.analyticsStartedAt) {
    await interaction.reply({
      content: "ゲームは既に始まっています。",
      ephemeral: true,
    });
    return;
  }
  if (game.starting) {
    await interaction.reply({
      content: "ゲーム開始を処理中です。少し待ってください。",
      ephemeral: true,
    });
    return;
  }
  if (game.roleConfig.分断者 > 0 && !hasDivisionChannelPermission(game)) {
    await interaction.reply({
      content:
        "分断者を使うには、Botロールへ「チャンネル管理」権限を付けてください。「サーバー管理」権限は不要です。",
      ephemeral: true,
    });
    return;
  }
  if (game.roleDmFailures.size === 0) {
    game.players = game.players.filter((player) => !player.isNpc);
    while (game.players.length < game.targetPlayerCount) addNpc(game);
  }

  game.starting = true;
  try {
    await interaction.deferUpdate();
    await startGame(game);
  } finally {
    if (games.get(game.channelId) === game) game.starting = false;
  }
}

async function handleCancel(
  interaction: ButtonInteraction,
  game: GameState,
): Promise<void> {
  if (interaction.user.id !== game.hostId) {
    await interaction.reply({
      content: "募集を中止できるのは主催者だけです。",
      ephemeral: true,
    });
    return;
  }
  if (game.phase !== "lobby" || game.analyticsStartedAt) {
    await interaction.reply({
      content: "ゲーム開始後は `/reset` を使用してください。",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();
  await resetChannel(game.channelId, false);
  await interaction.editReply({
    content: "募集を中止しました。",
    embeds: [],
    components: [],
  });
}

function recordSeerResult(
  game: GameState,
  seerId: string,
  target: Player,
): void {
  const results = game.seerResults.get(seerId) ?? [];
  // 配列の位置を「何日目の結果か」として扱うため、同じ相手を再度
  // 占った場合もその夜の記録を残す。重複を捨てると以降の日付がずれる。
  results.push({
    targetId: target.id,
    isWolf: publicResultForRole(target.role) === "人狼",
  });
  game.seerResults.set(seerId, results);
}

function initializeSeerResults(game: GameState): void {
  game.openingDeathIds = [];
  for (const seer of game.players.filter(
    (player) => player.role === "占い師",
  )) {
    const targets = game.players.filter(
      (player) => player.alive && player.id !== seer.id,
    );
    if (!targets.length) continue;
    const target = randomItem(targets);
    recordSeerResult(game, seer.id, target);
    if (target.role === "妖狐") {
      target.alive = false;
      game.openingDeathIds.push(target.id);
    }
  }
}

export function roleDmEmbed(game: GameState, player: Player): EmbedBuilder {
  const role = player.role as RoleName;
  const info = ROLE_INFO[role];
  const allies =
    isActualWolfRole(role) || role === "狂信者"
      ? game.players
          .filter(
            (other) => isActualWolfRole(other.role) && other.id !== player.id,
          )
          .map((other) => safeName(other))
      : role === "共有者"
        ? game.players
            .filter(
              (other) => other.role === "共有者" && other.id !== player.id,
            )
            .map((other) => safeName(other))
        : [];
  const allyLabel = role === "共有者" ? "共有者の相方" : "人狼";
  const allyText = allies.length ? `\n${allyLabel}: ${allies.join("、")}` : "";
  const firstResult = game.seerResults.get(player.id)?.[0];
  const firstTarget = firstResult
    ? game.players.find((target) => target.id === firstResult.targetId)
    : undefined;
  const firstResultText =
    role === "占い師" && firstResult && firstTarget
      ? `\n\n🔮 初日の占い結果: **${safeName(firstTarget)}** は **${firstResult.isWolf ? "人狼" : "人間"}** です。`
      : "";
  const winCondition =
    role === "妖狐"
      ? "決着時まで生存して妖狐陣営で勝利する"
      : role === "キューピッド"
        ? "結んだ恋人2人を生存させる"
        : role === "純愛者"
          ? "選んだ想い人を生存・勝利させる"
          : role === "てるてる"
            ? "投票で自分が処刑される"
            : info.team === "wolf"
              ? "人狼陣営を勝利させる"
              : "人狼を全員処刑する";

  return new EmbedBuilder()
    .setTitle(`${info.icon} 役職｜${role}`)
    .setDescription(`${info.description}${allyText}${firstResultText}`)
    .addFields({
      name: "勝利条件",
      value: winCondition,
    })
    .setColor(
      info.team === "wolf"
        ? COLORS.danger
        : info.team === "third"
          ? COLORS.vote
          : COLORS.lobby,
    );
}

export function gameStartEmbed(game: GameState): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`ゲーム開始｜${game.players.length}人`)
    .setDescription("役職をDMに送信しました。\n確認したらゲーム開始です。")
    .addFields({ name: "配役", value: roleConfigRows(game) })
    .setColor(COLORS.lobby)
    .setFooter({ text: "まもなく最初の議論が始まります" });
}

export function interruptedGameEmbed(
  game: Pick<GameState, "day">,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("ゲーム終了｜中断")
    .setDescription("主催者または管理者が進行中のゲームを終了しました。")
    .setColor(COLORS.danger)
    .setFooter({
      text: game.day > 0 ? `${game.day}日目で中断` : "開始前に中断",
    });
}

async function startGame(game: GameState): Promise<void> {
  if (games.get(game.channelId) !== game) return;
  const hasPreparedRoles = game.players.every((player) => player.role);
  const preparedRolesNow = !hasPreparedRoles;
  const canDiscardPreparedRoles =
    preparedRolesNow || game.roleDmSent.size === 0;
  if (!hasPreparedRoles) {
    const assignments = assignGameRoles(
      game.players,
      Math.random,
      configuredRoles(game),
    );
    game.players.forEach((player) => {
      player.role = assignments.get(player.id);
      player.alive = true;
    });
    game.day = 1;
    game.seerResults.clear();
    game.openingDeathIds = [];
    game.roleDmSent.clear();
    game.voteHistory = [];
    game.npcClaims = [];
    game.claimHistory = [];
    game.npcSeerClaimPlans = planNpcSeerClaims(game.players);
    game.roleDeclarations.clear();
    game.npcMemory.clear();
    game.npcQuestionCounts.clear();
    game.executionHistory = [];
    game.nightHistory = [];
    game.postgameRecapState = "idle";
    game.wolfChatCounts.clear();
    game.loverPairs = [];
    game.devoteeTargets = new Map();
    game.usedRolePowers = new Set();
    game.fatalWoundIds = new Set();
    game.pendingDivision = undefined;
    game.divisionGroups = new Map();
    game.divisionChannels = undefined;
    game.divisionPhaseMessages = undefined;
    game.divisionOriginalViewPermissions = undefined;
    game.loquaciousMissions = new Map();
    game.loquaciousCompleted = new Set();
    game.pendingDmMessages.clear();
    game.analyticsSessionId ??= randomUUID();
    // 匿名プレイ分析と戦績を、同じ試合IDから直接結合できないよう分離する。
    game.statsMatchId = randomUUID();
    game.statsRecorded = false;
    initializeSeerResults(game);
  }

  game.roleDmFailures.clear();
  try {
    if (!game.lobbyMessage) throw new Error("Lobby message is unavailable.");
    await game.lobbyMessage.edit({
      content: "",
      embeds: [gameStartEmbed(game)],
      components: [],
    });
  } catch (error) {
    if (canDiscardPreparedRoles) {
      game.players = game.players
        .filter((player) => !player.isNpc)
        .map((player) => ({
          ...player,
          role: undefined,
          alive: true,
        }));
      game.day = 0;
      game.seerResults.clear();
      game.npcSeerClaimPlans.clear();
      game.roleDmSent.clear();
      game.roleDmFailures.clear();
      game.pendingDmMessages.clear();
      game.statsMatchId = undefined;
      game.statsRecorded = false;
    }
    throw error;
  }
  if (games.get(game.channelId) !== game) return;

  await Promise.all(
    game.players.map(async (player) => {
      if (player.isNpc || !player.user || game.roleDmSent.has(player.id))
        return;
      try {
        await player.user.send({ embeds: [roleDmEmbed(game, player)] });
        game.roleDmSent.add(player.id);
      } catch {
        game.roleDmFailures.add(player.id);
      }
    }),
  );
  if (games.get(game.channelId) !== game) return;

  if (game.roleDmFailures.size > 0) {
    await game.lobbyMessage?.edit({ content: "", ...lobbyPayload(game) });
    return;
  }

  if (!game.analyticsStartedAt) {
    game.analyticsStartedAt = Date.now();
    game.analyticsCompleted = false;
    game.statsMatchId ??= randomUUID();
    const analytics = {
      ...analyticsSnapshot(game),
      startedAt: new Date(game.analyticsStartedAt).toISOString(),
    };
    const participants = game.players
      .filter((player) => !player.isNpc)
      .map((player) => ({
        userId: player.id,
        isHost: player.id === game.hostId,
      }));
    game.analyticsFeedbackEligibleUserIds ??= new Set();
    for (const participant of participants)
      game.analyticsFeedbackEligibleUserIds.add(participant.userId);
    queueAnalytics(game, async () => {
      await recordGameStarted(analytics);
      await recordSessionParticipants({
        sessionId: analytics.sessionId,
        participants,
      });
    });
  }

  if (games.get(game.channelId) !== game) return;
  game.phaseMessage = undefined;
  clearGameTimers(game);
  schedule(game, START_HOLD_SECONDS * 1000, () => startDay(game));
}

function activeHumanPlayer(
  game: GameState,
  userId: string,
): Player | undefined {
  return game.players.find(
    (player) => player.id === userId && !player.isNpc && player.alive,
  );
}

function claimedRoleFromToken(token: string): "占い師" | "霊能者" | undefined {
  if (token === "seer") return "占い師";
  if (token === "medium") return "霊能者";
  return undefined;
}

function claimTargets(
  game: GameState,
  claimant: Player,
  claimedRole: "占い師" | "霊能者",
): Player[] {
  const publishedIds = new Set(
    playerResultClaims(game, claimant.id, claimedRole).map(
      (claim) => claim.targetId,
    ),
  );
  const candidates =
    claimedRole === "霊能者"
      ? game.executionHistory
      : game.players.filter((player) => player.id !== claimant.id);
  return candidates.filter((player) => !publishedIds.has(player.id));
}

type TrueResultClaim = { day: number; target: Player; result: PublicResult };

export function availableTrueSeerClaims(
  game: GameState,
  claimant: Player,
): TrueResultClaim[] {
  const lockedRole = claimedRoleForPlayer(game, claimant.id);
  if (
    claimant.role !== "占い師" ||
    (lockedRole !== undefined && lockedRole !== "占い師")
  )
    return [];

  const availableDays = new Set(
    availableClaimDays(game, claimant.id, "占い師"),
  );
  if (availableDays.size === 0) return [];
  return (game.seerResults.get(claimant.id) ?? [])
    .map((result, index) => ({ ...result, day: index + 1 }))
    .filter((result) => availableDays.has(result.day))
    .flatMap((result) => {
      const target = game.players.find(
        (player) => player.id === result.targetId,
      );
      return target
        ? [
            {
              day: result.day,
              target,
              result: result.isWolf ? ("人狼" as const) : ("人間" as const),
            },
          ]
        : [];
    });
}

export function availableTrueMediumClaims(
  game: GameState,
  claimant: Player,
): TrueResultClaim[] {
  const lockedRole = claimedRoleForPlayer(game, claimant.id);
  if (
    claimant.role !== "霊能者" ||
    (lockedRole !== undefined && lockedRole !== "霊能者")
  )
    return [];

  const availableDays = new Set(
    availableClaimDays(game, claimant.id, "霊能者"),
  );
  const publishedIds = new Set(
    playerResultClaims(game, claimant.id, "霊能者").map(
      (claim) => claim.targetId,
    ),
  );
  return game.executionHistory
    .map((target, index) => ({
      day: index + 1,
      target,
      result: publicResultForRole(target.role),
    }))
    .filter(
      ({ day, target }) =>
        availableDays.has(day) && !publishedIds.has(target.id),
    );
}

export function hasConflictingSeerClaim(
  game: GameState,
  playerId: string,
): boolean {
  const actualResults = game.seerResults.get(playerId) ?? [];
  return playerResultClaims(game, playerId, "占い師").some((claim, index) => {
    const resultDay = claim.resultDay ?? index + 1;
    const actual = actualResults[resultDay - 1];
    if (!actual) return false;
    const actualResult: PublicResult = actual.isWolf ? "人狼" : "人間";
    return claim.targetId !== actual.targetId || claim.result !== actualResult;
  });
}

function trueResultClaimSummary(results: TrueResultClaim[]): string {
  return results
    .map(
      ({ day, target, result }) =>
        `${day}日目｜**${safeName(target)}** ${result === "人狼" ? "● 人狼" : "○ 人間"}`,
    )
    .join("\n");
}

function quickResultClaimButton(
  game: GameState,
  claimedRole: "占い師" | "霊能者",
) {
  const roleToken = claimedRole === "占い師" ? "seer" : "medium";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(`claim-quick-${roleToken}`, game))
      .setLabel("この結果を公開")
      .setEmoji(claimedRole === "占い師" ? "🔮" : "👻")
      .setStyle(ButtonStyle.Primary),
  );
}

function quickGuardClaimButton(game: GameState) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId("claim-quick-guard", game))
      .setLabel("騎士COする")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Primary),
  );
}

function customClaimButton(game: GameState) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId("claim-custom-open", game))
      .setLabel("別の内容でCO")
      .setEmoji("🎭")
      .setStyle(ButtonStyle.Secondary),
  );
}

function claimRetractionRow(game: GameState) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId("claim-retract", game))
      .setLabel("COを取り消す")
      .setEmoji("↩️")
      .setStyle(ButtonStyle.Danger),
  );
}

function claimRetractionConfirmRow(game: GameState) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId("claim-retract-confirm", game))
      .setLabel("取り消す")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(componentId("claim-retract-cancel", game))
      .setLabel("やめる")
      .setStyle(ButtonStyle.Secondary),
  );
}

function resultDayLabel(claimedRole: "占い師" | "霊能者", day: number) {
  return claimedRole === "占い師"
    ? `${day}日目の占い結果`
    : `${day}日目の処刑結果`;
}

function claimRoleRow(game: GameState, lockedRole?: ClaimedRole) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(componentId("claim-role", game))
    .setPlaceholder(
      lockedRole ? `${lockedRole}COを続ける` : "COする役職を選ぶ",
    );
  const options = [
    {
      role: "占い師" as const,
      option: {
        label: "占い師CO",
        value: "seer",
        emoji: "🔮",
        description: "占い結果を公開する",
      },
    },
    {
      role: "霊能者" as const,
      option: {
        label: "霊能者CO",
        value: "medium",
        emoji: "👻",
        description: "前日に処刑された人の結果を公開する",
      },
    },
    {
      role: "騎士" as const,
      option: {
        label: "騎士CO",
        value: "guard",
        emoji: "🛡️",
        description: "騎士だと公開する",
      },
    },
  ];
  menu.addOptions(
    options
      .filter(({ role }) => !lockedRole || role === lockedRole)
      .map(({ option }) => option),
  );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function customClaimTargetPanel(
  game: GameState,
  claimant: Player,
  claimedRole: "占い師" | "霊能者",
) {
  const resultDay = availableClaimDays(game, claimant.id, claimedRole)[0];
  if (resultDay === undefined)
    return { content: "現在公開できる結果はありません。", components: [] };

  const targets = claimTargets(game, claimant, claimedRole);
  if (targets.length === 0)
    return { content: "公開できる対象がいません。", components: [] };

  const roleToken = claimedRole === "占い師" ? "seer" : "medium";
  const menu = new StringSelectMenuBuilder()
    .setCustomId(componentId(`claim-target-${roleToken}-${resultDay}`, game))
    .setPlaceholder("判定する相手を選ぶ")
    .addOptions(playerOptions(targets));
  return {
    content: `**${claimedRole}CO｜${resultDayLabel(claimedRole, resultDay)}**\n判定する相手を選んでください。`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
  };
}

function claimListButton(game: GameState): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(componentId("claim-list", game))
    .setLabel("CO・判定一覧")
    .setEmoji("📋")
    .setStyle(ButtonStyle.Secondary);
}

async function handleClaimListButton(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const participant = game.players.find(
    (player) => player.id === interaction.user.id && !player.isNpc,
  );
  if (
    (game.phase !== "day" && game.phase !== "voting") ||
    day !== game.day ||
    !participant
  ) {
    await interaction.reply({
      content: "現在はCO・判定一覧を確認できません。",
      ephemeral: true,
    });
    return;
  }
  const group = game.divisionGroups?.get(participant.id);
  const visibleSpeakerIds = group
    ? new Set(
        game.players
          .filter((player) => game.divisionGroups?.get(player.id) === group)
          .map((player) => player.id),
      )
    : undefined;
  await interaction.reply({
    embeds: [claimListEmbed(game, visibleSpeakerIds)],
    ephemeral: true,
  });
}

export function claimPanel(game: GameState, claimant: Player): PhasePayload {
  const lockedRole = claimedRoleForPlayer(game, claimant.id);
  const seerResults = availableTrueSeerClaims(game, claimant);
  const mediumResults = availableTrueMediumClaims(game, claimant);
  const canQuickGuard = claimant.role === "騎士" && lockedRole === undefined;
  const canChooseDetails =
    !lockedRole ||
    (lockedRole !== "騎士" &&
      remainingClaimSlots(game, claimant.id, lockedRole) > 0);
  const components: PhaseRow[] = [];
  const hasQuickResult = seerResults.length > 0 || mediumResults.length > 0;
  const hasQuickClaim = hasQuickResult || canQuickGuard;

  if (seerResults.length > 0)
    components.push(quickResultClaimButton(game, "占い師"));
  if (mediumResults.length > 0)
    components.push(quickResultClaimButton(game, "霊能者"));
  if (canQuickGuard) components.push(quickGuardClaimButton(game));
  if (canChooseDetails) {
    if (hasQuickClaim) components.push(customClaimButton(game));
    else if (!lockedRole) components.push(claimRoleRow(game));
    else
      components.push(
        ...customClaimTargetPanel(game, claimant, lockedRole).components,
      );
  }
  if (lockedRole) components.push(claimRetractionRow(game));

  const lines: string[] = [];
  const trueResults = seerResults.length > 0 ? seerResults : mediumResults;
  if (trueResults.length > 0) {
    lines.push(
      `**公開する${seerResults.length > 0 ? "占い" : "霊能"}結果**`,
      trueResultClaimSummary(trueResults),
    );
  } else if (canQuickGuard) {
    lines.push("**騎士COしますか？**");
  } else if (!lockedRole) {
    lines.push("**COする役職を選んでください。**");
  } else if (canChooseDetails) {
    lines.push(
      `**${lockedRole}CO｜次の結果**`,
      "判定する相手を選んでください。",
    );
  } else {
    lines.push(`**${lockedRole}CO済み**`, "現在公開できる結果はありません。");
  }
  if (hasConflictingSeerClaim(game, claimant.id))
    lines.push("\n⚠️ 本当の占い結果へ戻すには、現在のCOを取り消してください。");

  return { content: lines.join("\n"), embeds: [], components };
}

async function handleClaimButton(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  if (game.phase !== "day" || day !== game.day || !claimant) {
    await interaction.reply({
      content: "現在は役職COできません。",
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({ ...claimPanel(game, claimant), ephemeral: true });
}

async function handleQuickResultClaim(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
  claimedRole: "占い師" | "霊能者",
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  if (game.phase !== "day" || day !== game.day || !claimant) {
    await interaction.reply({
      content: "現在は結果を公開できません。",
      ephemeral: true,
    });
    return;
  }

  const quickResults =
    claimedRole === "占い師"
      ? availableTrueSeerClaims(game, claimant)
      : availableTrueMediumClaims(game, claimant);
  if (quickResults.length === 0) {
    await interaction.update({
      content: "そのまま公開できる本当の結果はありません。",
      components: [],
    });
    return;
  }

  const publishedLines: string[] = [];
  for (const { day: resultDay, target, result } of quickResults) {
    if (
      !recordRoleClaim(game, claimant, claimedRole, target, result, resultDay)
    )
      continue;
    if (claimedRole === "占い師")
      applyPublicClaimSuspicion(game, target, result);
    publishedLines.push(
      roleClaimLine(claimant, claimedRole, target, result, resultDay),
    );
  }
  if (publishedLines.length === 0) {
    await interaction.update({
      content: "その占い結果はすでに公開済みです。",
      components: [],
    });
    return;
  }

  await interaction.update({
    content:
      publishedLines.length > 1
        ? `実際の${claimedRole === "占い師" ? "占い" : "霊能"}結果を${publishedLines.length}件まとめて公開しました。`
        : `実際の${claimedRole === "占い師" ? "占い" : "霊能"}結果をそのまま公開しました。`,
    components: [],
  });
  await sendDiscussionMessage(game, claimant, publishedLines.join("\n"));
}

async function handleQuickGuardClaim(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  if (
    game.phase !== "day" ||
    day !== game.day ||
    !claimant ||
    claimant.role !== "騎士" ||
    claimedRoleForPlayer(game, claimant.id) !== undefined
  ) {
    await interaction.reply({
      content: "現在は騎士COを公開できません。",
      ephemeral: true,
    });
    return;
  }
  recordGuardDeclaration(game, claimant);
  await interaction.update({
    content: "騎士COを公開しました。",
    components: [],
  });
  await sendDiscussionMessage(
    game,
    claimant,
    roleDeclarationLine(claimant, "騎士"),
  );
}

async function handleCustomClaimOpen(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  const lockedRole = claimant
    ? claimedRoleForPlayer(game, claimant.id)
    : undefined;
  const canChooseDetails =
    !lockedRole ||
    (lockedRole !== "騎士" &&
      claimant !== undefined &&
      remainingClaimSlots(game, claimant.id, lockedRole) > 0);
  if (
    game.phase !== "day" ||
    day !== game.day ||
    !claimant ||
    !canChooseDetails
  ) {
    await interaction.reply({
      content: "現在はCO内容を設定できません。",
      ephemeral: true,
    });
    return;
  }
  if (lockedRole) {
    await interaction.update(
      customClaimTargetPanel(game, claimant, lockedRole),
    );
    return;
  }
  await interaction.update({
    content: "**別の内容でCO**\n名乗る役職を選んでください。",
    components: [claimRoleRow(game)],
  });
}

export function retractPlayerClaim(
  game: GameState,
  playerId: string,
): ClaimedRole | undefined {
  const claimedRole = claimedRoleForPlayer(game, playerId);
  if (!claimedRole) return undefined;

  game.claimHistory.push({
    action: "retract",
    day: game.day,
    speakerId: playerId,
    claimedRole,
  });

  game.npcClaims = game.npcClaims.filter(
    (claim) => claim.speakerId !== playerId,
  );
  for (const declaration of [...game.roleDeclarations]) {
    if (declaration.split(":")[1] === playerId)
      game.roleDeclarations.delete(declaration);
  }

  game.npcSuspicion.clear();
  for (const claim of game.npcClaims.filter(
    (candidate) => candidate.day === game.day,
  )) {
    const target = game.players.find((player) => player.id === claim.targetId);
    if (target) applyPublicClaimSuspicion(game, target, claim.result);
  }
  return claimedRole;
}

async function handleClaimRetractionPrompt(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  const claimedRole = claimant
    ? claimedRoleForPlayer(game, claimant.id)
    : undefined;
  if (game.phase !== "day" || day !== game.day || !claimant || !claimedRole) {
    await interaction.reply({
      content: "現在取り消せるCOはありません。",
      ephemeral: true,
    });
    return;
  }
  await interaction.update({
    content: `**${claimedRole}COを取り消しますか？**\n公開済みの判定もすべて無効になります。取り消したことは${game.divisionGroups?.has(claimant.id) ? "同じ分断部屋" : "全員"}に通知されます。`,
    components: [claimRetractionConfirmRow(game)],
  });
}

async function handleClaimRetractionConfirm(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  if (game.phase !== "day" || day !== game.day || !claimant) {
    await interaction.reply({
      content: "現在COを取り消せません。",
      ephemeral: true,
    });
    return;
  }
  const claimedRole = retractPlayerClaim(game, claimant.id);
  if (!claimedRole) {
    await interaction.update({
      content: "取り消せるCOはありません。",
      components: [],
    });
    return;
  }
  await interaction.update({
    content: `${claimedRole}COを取り消しました。もう一度COし直せます。`,
    components: [],
  });
  await sendDiscussionMessage(
    game,
    claimant,
    roleRetractionLine(claimant, claimedRole),
  );
}

async function handleClaimRetractionCancel(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.update({
    content: "COの取り消しをやめました。",
    components: [],
  });
}

async function handleClaimRole(
  interaction: StringSelectMenuInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  const roleToken = interaction.values[0];
  const requestedRole: ClaimedRole | undefined =
    roleToken === "guard" ? "騎士" : claimedRoleFromToken(roleToken);
  if (game.phase !== "day" || day !== game.day || !claimant || !requestedRole) {
    await interaction.reply({
      content: "現在は役職COできません。",
      ephemeral: true,
    });
    return;
  }
  const lockedRole = claimedRoleForPlayer(game, claimant.id);
  if (lockedRole && lockedRole !== requestedRole) {
    await interaction.update({
      content: `この試合ではすでに${lockedRole}COをしています。役職は変更できません。`,
      components: [],
    });
    return;
  }
  if (requestedRole === "騎士") {
    if (lockedRole === "騎士") {
      await interaction.update({
        content: "騎士COはすでに公開しています。",
        components: [],
      });
      return;
    }
    recordGuardDeclaration(game, claimant);
    await interaction.update({ content: "COを公開しました。", components: [] });
    await sendDiscussionMessage(
      game,
      claimant,
      roleDeclarationLine(claimant, "騎士"),
    );
    return;
  }
  const claimedRole = requestedRole;

  if (remainingClaimSlots(game, claimant.id, claimedRole) === 0) {
    await interaction.update({
      content: "現在公開できるCO結果はすべて公開済みです。",
      components: [],
    });
    return;
  }
  await interaction.update(customClaimTargetPanel(game, claimant, claimedRole));
}

function parseClaimResultAction(
  action: string,
  step: "target" | "result",
):
  | { roleToken: string; claimedRole: "占い師" | "霊能者"; resultDay: number }
  | undefined {
  const match = new RegExp(`^claim-${step}-(seer|medium)-(\\d+)$`).exec(action);
  if (!match) return undefined;
  const claimedRole = claimedRoleFromToken(match[1]);
  const resultDay = Number(match[2]);
  return claimedRole && Number.isInteger(resultDay)
    ? { roleToken: match[1], claimedRole, resultDay }
    : undefined;
}

async function handleClaimTarget(
  interaction: StringSelectMenuInteraction,
  game: GameState,
  day: number,
  action: string,
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  const request = parseClaimResultAction(action, "target");
  const roleToken = request?.roleToken;
  const claimedRole = request?.claimedRole;
  const resultDay = request?.resultDay;
  const target = game.players.find(
    (player) => player.id === interaction.values[0],
  );
  if (
    game.phase !== "day" ||
    day !== game.day ||
    !claimant ||
    !request ||
    !claimedRole ||
    resultDay === undefined ||
    !target ||
    (claimedRoleForPlayer(game, claimant.id) !== undefined &&
      claimedRoleForPlayer(game, claimant.id) !== claimedRole) ||
    !availableClaimDays(game, claimant.id, claimedRole).includes(resultDay) ||
    !claimTargets(game, claimant, claimedRole).some(
      (candidate) => candidate.id === target.id,
    )
  ) {
    await interaction.reply({
      content: "そのCOは公開できません。",
      ephemeral: true,
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(componentId(`claim-result-${roleToken}-${resultDay}`, game))
    .setPlaceholder(`${safeName(target)}への判定を選ぶ`)
    .addOptions(
      { label: "人狼判定", value: `${target.id}|人狼`, emoji: "🐺" },
      { label: "人間判定", value: `${target.id}|人間`, emoji: "🟢" },
    );
  await interaction.update({
    content: `**${resultDayLabel(claimedRole, resultDay)}**｜**${safeName(target)}** への判定を選んでください。`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
  });
}

async function handleClaimResult(
  interaction: StringSelectMenuInteraction,
  game: GameState,
  day: number,
  action: string,
): Promise<void> {
  const claimant = activeHumanPlayer(game, interaction.user.id);
  const request = parseClaimResultAction(action, "result");
  const claimedRole = request?.claimedRole;
  const resultDay = request?.resultDay;
  const [targetId, resultText] = interaction.values[0].split("|");
  const target = game.players.find((player) => player.id === targetId);
  const result =
    resultText === "人狼" || resultText === "人間" ? resultText : undefined;
  if (
    game.phase !== "day" ||
    day !== game.day ||
    !claimant ||
    !request ||
    !claimedRole ||
    resultDay === undefined ||
    !target ||
    !result ||
    (claimedRoleForPlayer(game, claimant.id) !== undefined &&
      claimedRoleForPlayer(game, claimant.id) !== claimedRole) ||
    !availableClaimDays(game, claimant.id, claimedRole).includes(resultDay) ||
    !claimTargets(game, claimant, claimedRole).some(
      (candidate) => candidate.id === target.id,
    )
  ) {
    await interaction.reply({
      content: "そのCOは公開できません。",
      ephemeral: true,
    });
    return;
  }

  if (
    !recordRoleClaim(game, claimant, claimedRole, target, result, resultDay)
  ) {
    await interaction.update({
      content: "同じ相手へのCOはすでに公開済みです。",
      components: [],
    });
    return;
  }
  if (claimedRole === "占い師") {
    applyPublicClaimSuspicion(game, target, result);
  }
  const remaining = remainingClaimSlots(game, claimant.id, claimedRole);
  await interaction.update({
    content:
      remaining > 0
        ? `COを公開しました。あと${remaining}件公開できます。`
        : "COを公開しました。",
    components: [],
  });
  await sendDiscussionMessage(
    game,
    claimant,
    roleClaimLine(claimant, claimedRole, target, result, resultDay),
  );
}

export function divisionGroupsForPlayers(
  living: Player[],
  dividerId: string,
  targetId: string,
): Map<string, "A" | "B"> {
  const togetherIds = new Set([dividerId, targetId]);
  const roomA = living.filter((player) => togetherIds.has(player.id));
  const remaining = living.filter((player) => !togetherIds.has(player.id));
  const roomATargetSize = Math.ceil(living.length / 2);
  while (roomA.length < roomATargetSize && remaining.length > 0) {
    const next = remaining.shift();
    if (next) roomA.push(next);
  }
  return new Map([
    ...roomA.map((player) => [player.id, "A"] as const),
    ...remaining.map((player) => [player.id, "B"] as const),
  ]);
}

async function prepareDayRoleEffects(game: GameState): Promise<void> {
  game.divisionGroups = new Map();
  if (game.pendingDivision?.day === game.day) {
    const living = shuffle(alivePlayers(game));
    game.divisionGroups = divisionGroupsForPlayers(
      living,
      game.pendingDivision.dividerId,
      game.pendingDivision.targetId,
    );
    game.pendingDivision = undefined;
    await activateDivisionChannels(game);
  }

  game.loquaciousMissions = new Map();
  game.loquaciousCompleted = new Set();
  await Promise.all(
    alivePlayers(game)
      .filter((player) => player.role === "饒舌な人狼")
      .map(async (player) => {
        const word = randomItem(LOQUACIOUS_WORDS);
        loquaciousMissions(game).set(player.id, word);
        if (player.isNpc) {
          if (Math.random() < 0.9) loquaciousCompleted(game).add(player.id);
          return;
        }
        if (!player.user) {
          loquaciousCompleted(game).add(player.id);
          return;
        }
        const sent = await player.user
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle("🗣️ 饒舌ミッション")
                .setDescription(
                  `今日のお題は **「${word}」** です。議論中に、お題を含むメッセージを自分で送信してください。夜までに達成できないと死亡します。`,
                )
                .setColor(COLORS.danger),
            ],
          })
          .then(
            () => true,
            () => false,
          );
        if (!sent) {
          // DM不達だけを理由に突然死させない。
          loquaciousCompleted(game).add(player.id);
          queuePrivateNotice(
            game,
            player.id,
            `饒舌ミッションのお題は「${word}」でした。DM不達のため自動達成扱いです。`,
          );
        }
      }),
  );
}

async function startDay(game: GameState): Promise<void> {
  if (!isActiveGame(game)) return;
  clearGameTimers(game);
  game.phase = "day";
  game.votes.clear();
  game.nightChoices.clear();
  game.npcSuspicion.clear();
  decayNpcMemory(game);
  game.humanSuspicions.clear();
  game.npcQuestionCounts.clear();
  game.resolving = false;
  game.resolutionQueued = false;
  game.phaseStartedAt = Date.now();
  await flushPendingDmMessages(game);
  if (!isActiveGame(game)) return;
  await prepareDayRoleEffects(game);
  if (!isActiveGame(game)) return;

  const living = alivePlayers(game);
  const livingHumanPlayers = aliveHumans(game);
  const daySeconds = discussionSecondsForGame(
    game,
    living.length,
    livingHumanPlayers.length,
  );
  game.phaseEndsAt = Date.now() + daySeconds * 1000;
  const hasNpc = living.some((player) => player.isNpc);
  const dayComponents: PhaseRow[] = [];
  if (livingHumanPlayers.length > 0 && hasNpc && living.length > 1) {
    dayComponents.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(componentId("suspect-open", game))
          .setLabel("意見を表明")
          .setEmoji("💬")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(componentId("npc-question-open", game))
          .setLabel("NPCに聞く")
          .setEmoji("❓")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  if (livingHumanPlayers.length > 0) {
    dayComponents.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(componentId("claim", game))
          .setLabel("COする")
          .setEmoji("📣")
          .setStyle(ButtonStyle.Secondary),
        claimListButton(game),
      ),
    );
  }
  if (!(await openDiscussionPanels(game, dayComponents))) return;

  scheduleNpcDiscussion(game, daySeconds);
  schedule(game, daySeconds * 1000, () => startVoting(game));
}

function scheduleNpcDiscussion(game: GameState, daySeconds: number): void {
  const maxOrdinarySpeakers = aliveHumans(game).length >= 2 ? 1 : 3;
  const speakingNpcs = npcDiscussionSpeakers(game, maxOrdinarySpeakers);
  speakingNpcs.forEach((npc, index) => {
    const availableMs = Math.max(2000, daySeconds * 1000 - 2000);
    const delayMs = Math.min(4000 + index * 7000, availableMs);
    schedule(game, delayMs, async () => {
      if (game.phase !== "day" || !npc.alive) return;
      const npcGroup = game.divisionGroups?.get(npc.id);
      const targets = alivePlayers(game).filter(
        (player) =>
          player.id !== npc.id &&
          (!npcGroup || game.divisionGroups?.get(player.id) === npcGroup),
      );
      if (!targets.length) return;

      const knownResults =
        npc.role === "占い師" ? availableTrueSeerClaims(game, npc) : [];
      if (knownResults.length > 0) {
        const publishedLines: string[] = [];
        for (const { day: resultDay, target, result } of knownResults) {
          if (!recordRoleClaim(game, npc, "占い師", target, result, resultDay))
            continue;
          rememberSuspect(game, npc.id, target.id, result === "人狼" ? 6 : -3);
          applyPublicClaimSuspicion(game, target, result);
          publishedLines.push(
            roleClaimLine(npc, "占い師", target, result, resultDay),
          );
        }
        if (publishedLines.length > 0)
          await sendDiscussionMessage(game, npc, publishedLines.join("\n"));
        return;
      }

      if (npc.role === "霊能者" && game.lastExecuted) {
        const resultText = publicResultForRole(game.lastExecuted.role);
        const resultDay = game.executionHistory.length;
        if (
          !recordRoleClaim(
            game,
            npc,
            "霊能者",
            game.lastExecuted,
            resultText,
            resultDay,
          )
        )
          return;
        await sendDiscussionMessage(
          game,
          npc,
          roleClaimLine(
            npc,
            "霊能者",
            game.lastExecuted,
            resultText,
            resultDay,
          ),
        );
        return;
      }

      const isContinuingSeerClaim = hasNpcClaimedRole(game, npc.id, "占い師");
      const startsPlannedClaim = npcSeerClaimPlanStartsOnDay(
        game.npcSeerClaimPlans.get(npc.id),
        game.day,
      );
      if (
        (isWolfTeamRole(npc.role) || npc.role === "てるてる") &&
        availableClaimDays(game, npc.id, "占い師").length > 0 &&
        (isContinuingSeerClaim || startsPlannedClaim)
      ) {
        const claimDays = npcFakeSeerClaimDays(
          game,
          npc.id,
          isContinuingSeerClaim,
        );
        const publishedLines: string[] = [];
        for (const resultDay of claimDays) {
          const availableFakeTargets =
            npc.role !== "狂人"
              ? targets.filter((target) => !isActualWolfRole(target.role))
              : targets;
          const claimedTargetIds = new Set(
            game.npcClaims
              .filter(
                (claim) =>
                  claim.speakerId === npc.id && claim.claimedRole === "占い師",
              )
              .map((claim) => claim.targetId),
          );
          const unclaimedFakeTargets = availableFakeTargets.filter(
            (target) => !claimedTargetIds.has(target.id),
          );
          const fakeTargets = unclaimedFakeTargets.length
            ? unclaimedFakeTargets
            : availableFakeTargets.length
              ? availableFakeTargets
              : targets;
          const target = randomItem(fakeTargets);
          const earlierResult = game.npcClaims.find(
            (claim) =>
              claim.speakerId === npc.id &&
              claim.claimedRole === "占い師" &&
              claim.targetId === target.id,
          )?.result;
          const fakeResult: PublicResult =
            earlierResult ??
            (npc.role === "狂人" && Math.random() < MADMAN_WHITE_CLAIM_CHANCE
              ? "人間"
              : "人狼");
          if (
            !recordRoleClaim(game, npc, "占い師", target, fakeResult, resultDay)
          )
            continue;
          rememberSuspect(
            game,
            npc.id,
            target.id,
            fakeResult === "人狼" ? 2 : -1,
          );
          applyPublicClaimSuspicion(game, target, fakeResult);
          publishedLines.push(
            roleClaimLine(npc, "占い師", target, fakeResult, resultDay),
          );
        }
        if (publishedLines.length > 0)
          await sendDiscussionMessage(game, npc, publishedLines.join("\n"));
        return;
      }

      const personality = npc.npcPersonality ?? "慎重";
      const insight = findNpcInsight(
        game.npcClaims,
        game.voteHistory,
        npc.id,
        new Set(targets.map((target) => target.id)),
      );
      if (insight) {
        const suspect = targets.find(
          (candidate) => candidate.id === insight.suspectId,
        );
        if (suspect) {
          rememberSuspect(game, npc.id, suspect.id, 4);
          const line = npcOpinionLine(
            personality,
            safeName(suspect),
            insight.reason,
          );
          await sendDiscussionMessage(
            game,
            npc,
            `**${safeName(npc)}**（NPC）　${line}`,
          );
          return;
        }
      }

      const suspicion = npcDecisionSuspicion(game, npc);
      const targetId = chooseNpcVoteTarget(npc, targets, suspicion);
      const target = targets.find((candidate) => candidate.id === targetId);
      if (!target) return;
      rememberSuspect(game, npc.id, target.id, 1);
      const line = npcOpinionLine(
        personality,
        safeName(target),
        previousVoteReason(game, target.id),
      );
      await sendDiscussionMessage(
        game,
        npc,
        `**${safeName(npc)}**（NPC）　${line}`,
      );
    });
  });
}

async function updateVoteProgress(game: GameState): Promise<void> {
  if (!isActiveGame(game) || game.phase !== "voting" || game.resolving) return;
  const message = game.phaseMessage;
  if (!message) return;
  const embed = voteEmbed(game);
  if (!isActiveGame(game) || game.phase !== "voting" || game.resolving) return;
  await message.edit({ embeds: [embed] }).catch(() => undefined);
}

function scheduleNpcVotes(game: GameState): void {
  const npcs = alivePlayers(game).filter((player) => player.isNpc);
  const firstRound = game.voteHistory.find(
    (record) => record.day === game.day && record.round === 1,
  );
  const firstRoundCounts = new Map<string, number>();
  for (const ballot of firstRound?.ballots ?? []) {
    firstRoundCounts.set(
      ballot.targetId,
      (firstRoundCounts.get(ballot.targetId) ?? 0) + 1,
    );
  }
  npcs.forEach((npc, index) => {
    schedule(game, 1000 + index * 700, async () => {
      if (
        !isActiveGame(game) ||
        game.phase !== "voting" ||
        game.resolving ||
        !npc.alive
      )
        return;
      const targets = alivePlayers(game).filter(
        (player) =>
          player.id !== npc.id && game.voteCandidateIds.includes(player.id),
      );
      if (!targets.length) return;
      const suspicion = npcDecisionSuspicion(game, npc);
      const previousTargetId = firstRound?.ballots.find(
        (ballot) => ballot.voterId === npc.id,
      )?.targetId;
      const targetId =
        game.voteRound > 1
          ? chooseNpcRevoteTarget(
              npc,
              targets,
              suspicion,
              previousTargetId,
              firstRoundCounts,
            )
          : chooseNpcVoteTarget(npc, targets, suspicion);
      game.votes.set(npc.id, targetId);
      await updateVoteProgress(game);
      if (!isActiveGame(game) || game.phase !== "voting" || game.resolving)
        return;
      if (game.votes.size >= alivePlayers(game).length)
        queueVoteResolutionAfterMinimum(game);
    });
  });
}

async function startVoting(game: GameState): Promise<void> {
  if (!isActiveGame(game) || game.phase !== "day") return;
  const dayMessages = game.divisionPhaseMessages?.length
    ? game.divisionPhaseMessages
    : game.phaseMessage
      ? [game.phaseMessage]
      : [];
  await Promise.all(
    dayMessages.map((message) =>
      message
        .edit({ embeds: [finishedDayEmbed(game)], components: [] })
        .catch(() => undefined),
    ),
  );
  if (game.divisionChannels?.size) {
    try {
      await restoreDivisionChannels(game, "投票開始による分断解除");
    } catch (error) {
      console.error("Division permission restore before voting failed:", error);
      await Promise.all(
        [...game.divisionChannels.values()].map((channel) =>
          channel
            .send(
              "⚠️ 元のチャンネルへ戻せませんでした。Botに「チャンネル管理」権限を戻してから `/reset` を実行してください。",
            )
            .catch(() => undefined),
        ),
      );
      return;
    }
  }
  if (!isActiveGame(game)) return;
  game.phaseMessage = undefined;
  game.phase = "voting";
  game.voteRound = 1;
  game.voteCandidateIds = alivePlayers(game).map((player) => player.id);
  await beginVoting(game);
}

async function beginVoting(game: GameState): Promise<void> {
  if (!isActiveGame(game)) return;
  clearGameTimers(game);
  game.resolving = false;
  game.resolutionQueued = false;
  game.votes.clear();
  game.phaseStartedAt = Date.now();
  const voteSeconds = VOTE_SECONDS;
  game.phaseEndsAt = Date.now() + voteSeconds * 1000;
  const candidates = alivePlayers(game).filter((player) =>
    game.voteCandidateIds.includes(player.id),
  );

  const payload = {
    content: "",
    embeds: [voteEmbed(game)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(componentId("vote-open", game))
          .setLabel(game.voteRound > 1 ? "再投票する" : "投票する")
          .setEmoji("🗳️")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(candidates.length < 2),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        claimListButton(game),
      ),
    ],
  };
  if (!(await openPhasePanel(game, payload))) return;

  scheduleNpcVotes(game);
  schedule(game, voteSeconds * 1000, () => queueVoteResolution(game));
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function completeLoquaciousMissionForMessage(
  game: GameState,
  authorId: string,
  channelId: string,
  content: string,
): string | undefined {
  const player = activeHumanPlayer(game, authorId);
  const word = player ? loquaciousMissions(game).get(player.id) : undefined;
  if (
    game.phase !== "day" ||
    player?.role !== "饒舌な人狼" ||
    !word ||
    loquaciousCompleted(game).has(player.id)
  )
    return undefined;
  const group = game.divisionGroups?.get(player.id);
  const expectedChannelId = group
    ? game.divisionChannels?.get(group)?.id
    : game.channelId;
  if (channelId !== expectedChannelId || !content.includes(word))
    return undefined;
  loquaciousCompleted(game).add(player.id);
  return word;
}

export async function handleGuildMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot) return;
  const game = gameForChannelId(message.channelId);
  if (game?.channel.guildId !== message.guildId) return;
  if (!game || !isActiveGame(game)) return;
  const word = completeLoquaciousMissionForMessage(
    game,
    message.author.id,
    message.channelId,
    message.content,
  );
  if (!word) return;
  await message.author
    .send(`✅ お題「${word}」を確認しました。突然死を回避しました。`)
    .catch(() => undefined);
}

export function eliminateWithLovers(
  game: GameState,
  player: Player | undefined,
  deaths: Player[],
): void {
  if (!player?.alive) return;
  player.alive = false;
  deaths.push(player);
  const pair = loverPairs(game).find(
    ([left, right]) => left === player.id || right === player.id,
  );
  if (!pair) return;
  const partnerId = pair[0] === player.id ? pair[1] : pair[0];
  eliminateWithLovers(
    game,
    game.players.find((candidate) => candidate.id === partnerId),
    deaths,
  );
}

export function resolveWolfTarget(
  wolves: Player[],
  choices: ReadonlyMap<string, string>,
  fallback: Player[],
): string | undefined {
  const humanTargets = wolves
    .filter((wolf) => !wolf.isNpc)
    .map((wolf) => choices.get(nightActionKey("kill", wolf.id)))
    .filter((target): target is string => Boolean(target));
  const allTargets = wolves
    .map((wolf) => choices.get(nightActionKey("kill", wolf.id)))
    .filter((target): target is string => Boolean(target));
  const targets = humanTargets.length ? humanTargets : allTargets;
  if (targets.length === 0)
    return fallback.length ? randomItem(fallback).id : undefined;
  const leaders = topVotedIds(targets);
  return leaders.length === 1 ? leaders[0] : undefined;
}

export function voteTallyRows(game: GameState): string {
  const rows = countVotes(weightedVoteTargetIds(game)).map(({ id, count }) => {
    const player = game.players.find((candidate) => candidate.id === id);
    if (!player) return `不明：${count}票`;
    return `${player.isNpc ? "🤖" : "👤"} ${safeName(player)}：${count}票`;
  });
  return rows.join("\n") || "投票なし";
}

export function voteBallotFields(
  game: GameState,
): Array<{ name: string; value: string }> {
  const rows = game.players
    .filter((player) => game.votes.has(player.id))
    .map((voter) => {
      const target = game.players.find(
        (candidate) => candidate.id === game.votes.get(voter.id),
      );
      const voterText = `${voter.isNpc ? "🤖" : "👤"} ${safeName(voter)}`;
      const targetText = target
        ? `${target.isNpc ? "🤖" : "👤"} ${safeName(target)}`
        : "不明";
      return `${voterText}${voter.role === "市長" ? "（2票）" : ""} → ${targetText}`;
    });
  if (rows.length === 0) return [{ name: "投票先", value: "投票なし" }];

  const fields: Array<{ name: string; value: string }> = [];
  for (let index = 0; index < rows.length; index += 8) {
    fields.push({
      name: index === 0 ? "投票先" : "投票先（続き）",
      value: rows.slice(index, index + 8).join("\n"),
    });
  }
  return fields;
}

export function weightedVoteTargetIds(
  game: Pick<GameState, "players" | "votes">,
): string[] {
  return [...game.votes.entries()].flatMap(([voterId, targetId]) => {
    const voter = game.players.find((player) => player.id === voterId);
    return voter?.role === "市長" ? [targetId, targetId] : [targetId];
  });
}

export function recordCurrentVoteRound(game: GameState): void {
  if (
    game.voteHistory.some(
      (record) => record.day === game.day && record.round === game.voteRound,
    )
  )
    return;

  const ballots = [...game.votes.entries()].map(([voterId, targetId]) => ({
    voterId,
    targetId,
  }));
  game.voteHistory.push({ day: game.day, round: game.voteRound, ballots });

  const topIds = topVotedIds(ballots.map((ballot) => ballot.targetId));
  for (const npc of alivePlayers(game).filter((player) => player.isNpc)) {
    const ownTarget = game.votes.get(npc.id);
    if (ownTarget) rememberSuspect(game, npc.id, ownTarget, 0.5);
    if (npc.npcPersonality === "同調") {
      for (const targetId of topIds) {
        if (targetId !== npc.id) rememberSuspect(game, npc.id, targetId, 0.4);
      }
    }
  }
}

export function humanOpinionLine(
  actor: Player,
  target: Player,
  reason: HumanArgumentReason,
  previous?: { target: Player; argument: HumanArgument },
): string {
  const speaker = `**${safeName(actor)}**（プレイヤー）　👀`;
  const statement = previous
    ? `${speaker} 意見変更：**${safeName(previous.target)}** → **${safeName(target)}**`
    : `${speaker} **${safeName(target)}**を疑う`;
  return `${statement}\n根拠：${HUMAN_ARGUMENT_INFO[reason].publicText}`;
}

export function remainingNpcQuestions(
  game: GameState,
  playerId: string,
): number {
  return Math.max(
    0,
    NPC_QUESTIONS_PER_DAY - (game.npcQuestionCounts.get(playerId) ?? 0),
  );
}

export function npcQuestionLine(
  actor: Player,
  npc: Player,
  target: Player | undefined,
  reason: string,
): string {
  const answer = target
    ? `今は **${safeName(target)}** が気になる。${reason}。`
    : `今は特に疑っている人はいない。${reason}。`;
  return `**${safeName(actor)}**（プレイヤー）　❓ **${safeName(npc)}**に質問\n**${safeName(npc)}**（NPC）　💬 ${answer}`;
}

function previousVoteReason(
  game: GameState,
  targetId: string,
): string | undefined {
  const records = game.voteHistory.filter(
    (record) => record.day === game.day - 1,
  );
  if (records.length === 0) return undefined;
  const latest = records.sort((left, right) => right.round - left.round)[0];
  const count = latest.ballots.filter(
    (ballot) => ballot.targetId === targetId,
  ).length;
  return count >= 2 ? `昨日も${count}票集まっていた` : undefined;
}

async function handleSuspectOpen(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const actor = activeHumanPlayer(game, interaction.user.id);
  if (game.phase !== "day" || game.day !== day || !actor) {
    await interaction.reply({
      content: "現在は意見を表明できません。",
      ephemeral: true,
    });
    return;
  }
  const actorGroup = game.divisionGroups?.get(actor.id);
  const targets = alivePlayers(game).filter(
    (player) =>
      player.id !== actor.id &&
      (!actorGroup || game.divisionGroups?.get(player.id) === actorGroup),
  );
  if (targets.length === 0) {
    await interaction.reply({
      content: "指定できる相手がいません。",
      ephemeral: true,
    });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(componentId("suspect", game))
    .setPlaceholder("いま疑っている人を選ぶ")
    .addOptions(playerOptions(targets));
  await interaction.reply({
    content:
      "疑う相手を選んでください。次に根拠を選びます。意見はあとから変更できます。",
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
    ephemeral: true,
  });
}

async function handleVoteOpen(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const voter = activeHumanPlayer(game, interaction.user.id);
  if (game.phase !== "voting" || game.resolving || game.day !== day || !voter) {
    await interaction.reply({
      content: "現在は投票できません。",
      ephemeral: true,
    });
    return;
  }
  const targets = alivePlayers(game).filter(
    (player) =>
      player.id !== voter.id && game.voteCandidateIds.includes(player.id),
  );
  if (targets.length === 0) {
    await interaction.reply({
      content: "投票できる相手がいません。",
      ephemeral: true,
    });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(componentId("vote", game))
    .setPlaceholder(
      game.voteRound > 1
        ? "再投票する人を選んでください"
        : "処刑したい人を選んでください",
    )
    .addOptions(playerOptions(targets));
  await interaction.reply({
    content: game.votes.has(voter.id)
      ? "投票先を変更できます。"
      : "投票先を選んでください。",
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
    ephemeral: true,
  });
}

async function handleNpcQuestionOpen(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const actor = activeHumanPlayer(game, interaction.user.id);
  if (game.phase !== "day" || game.day !== day || !actor) {
    await interaction.reply({
      content: "現在はNPCに質問できません。",
      ephemeral: true,
    });
    return;
  }

  const remaining = remainingNpcQuestions(game, actor.id);
  if (remaining === 0) {
    await interaction.reply({
      content: "今日の質問は2回とも使いました。",
      ephemeral: true,
    });
    return;
  }

  const actorGroup = game.divisionGroups?.get(actor.id);
  const npcs = alivePlayers(game).filter(
    (player) =>
      player.isNpc &&
      (!actorGroup || game.divisionGroups?.get(player.id) === actorGroup),
  );
  if (npcs.length === 0) {
    await interaction.reply({
      content: "質問できるNPCがいません。",
      ephemeral: true,
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(componentId("npc-question", game))
    .setPlaceholder("話を聞きたいNPCを選ぶ")
    .addOptions(playerOptions(npcs));
  await interaction.reply({
    content: `回答は${game.divisionGroups?.has(actor.id) ? "同じ分断部屋" : "全員"}に公開されます。今日はあと${remaining}回質問できます。`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
    ephemeral: true,
  });
}

async function handleNpcQuestion(
  interaction: StringSelectMenuInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const actor = activeHumanPlayer(game, interaction.user.id);
  const npc = game.players.find(
    (player) =>
      player.id === interaction.values[0] && player.alive && player.isNpc,
  );
  if (game.phase !== "day" || game.day !== day || !actor || !npc) {
    await interaction.reply({
      content: "現在はNPCに質問できません。",
      ephemeral: true,
    });
    return;
  }
  if (!sharesDiscussionRoom(game, actor, npc)) {
    await interaction.reply({
      content: "別の分断部屋にいるNPCには質問できません。",
      ephemeral: true,
    });
    return;
  }

  if (remainingNpcQuestions(game, actor.id) === 0) {
    await interaction.reply({
      content: "今日の質問は2回とも使いました。",
      ephemeral: true,
    });
    return;
  }

  const answer = chooseNpcQuestionAnswer(game, npc);
  const target = answer?.targetId
    ? game.players.find((player) => player.id === answer.targetId)
    : undefined;
  if (!answer || (answer.targetId && !target)) {
    await interaction.reply({
      content: "いま聞ける意見がありません。",
      ephemeral: true,
    });
    return;
  }

  game.npcQuestionCounts.set(
    actor.id,
    (game.npcQuestionCounts.get(actor.id) ?? 0) + 1,
  );
  const remaining = remainingNpcQuestions(game, actor.id);
  await interaction.reply({
    content:
      remaining > 0
        ? `回答を公開しました。今日はあと${remaining}回質問できます。`
        : "回答を公開しました。今日の質問はこれで終了です。",
    ephemeral: true,
  });
  await sendDiscussionMessage(
    game,
    actor,
    npcQuestionLine(actor, npc, target, answer.reason),
  );
}

async function handleSuspect(
  interaction: StringSelectMenuInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const actor = game.players.find(
    (player) => player.id === interaction.user.id,
  );
  const target = game.players.find(
    (player) => player.id === interaction.values[0] && player.alive,
  );
  if (
    game.phase !== "day" ||
    game.day !== day ||
    !actor?.alive ||
    actor.isNpc ||
    !target ||
    !sharesDiscussionRoom(game, actor, target)
  ) {
    await interaction.reply({
      content: "現在は意見を表明できません。",
      ephemeral: true,
    });
    return;
  }
  if (actor.id === target.id) {
    await interaction.reply({
      content: "自分自身は指定できません。",
      ephemeral: true,
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(componentId("suspect-reason", game))
    .setPlaceholder("疑う根拠を選ぶ")
    .addOptions(
      HUMAN_ARGUMENT_REASONS.map((reason) => ({
        label: HUMAN_ARGUMENT_INFO[reason].label,
        description: HUMAN_ARGUMENT_INFO[reason].description,
        emoji: HUMAN_ARGUMENT_INFO[reason].emoji,
        value: `${target.id}|${reason}`,
      })),
    );
  await interaction.update({
    content: `**${safeName(target)}** を疑う根拠を選んでください。\n公開情報に合わない根拠は、NPCから逆に疑われることがあります。`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
  });
}

async function handleSuspectReason(
  interaction: StringSelectMenuInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const actor = activeHumanPlayer(game, interaction.user.id);
  const [targetId, reasonText] = interaction.values[0].split("|");
  const reason = HUMAN_ARGUMENT_REASONS.find(
    (candidate) => candidate === reasonText,
  );
  const target = game.players.find(
    (player) => player.id === targetId && player.alive,
  );
  if (
    game.phase !== "day" ||
    game.day !== day ||
    !actor ||
    !target ||
    actor.id === target.id ||
    !reason ||
    !sharesDiscussionRoom(game, actor, target)
  ) {
    await interaction.reply({
      content: "現在はその意見を表明できません。",
      ephemeral: true,
    });
    return;
  }

  const previousArgument = game.humanSuspicions.get(actor.id);
  if (
    previousArgument?.targetId === target.id &&
    previousArgument.reason === reason
  ) {
    await interaction.update({
      content: `その意見はすでに公開しています。`,
      components: [],
    });
    return;
  }
  const previousTarget = game.players.find(
    (player) => player.id === previousArgument?.targetId,
  );
  const argument: HumanArgument = { targetId: target.id, reason };
  game.humanSuspicions.set(actor.id, argument);
  await interaction.update({
    content: game.divisionGroups?.has(actor.id)
      ? "意見を公開しました。同じ分断部屋の参加者とNPCに見えています。"
      : "意見を公開しました。全員とNPCに見えています。",
    components: [],
  });
  await sendDiscussionMessage(
    game,
    actor,
    humanOpinionLine(
      actor,
      target,
      reason,
      previousTarget && previousArgument
        ? { target: previousTarget, argument: previousArgument }
        : undefined,
    ),
  );
}

async function handleVote(
  interaction: StringSelectMenuInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const voter = game.players.find(
    (player) => player.id === interaction.user.id,
  );
  if (
    game.phase !== "voting" ||
    game.resolving ||
    game.day !== day ||
    !voter?.alive
  ) {
    await interaction.reply({
      content: "現在は投票できません。",
      ephemeral: true,
    });
    return;
  }

  const targetId = interaction.values[0];
  if (targetId === voter.id) {
    await interaction.reply({
      content: "自分自身には投票できません。",
      ephemeral: true,
    });
    return;
  }
  if (
    !alivePlayers(game).some((player) => player.id === targetId) ||
    !game.voteCandidateIds.includes(targetId)
  ) {
    await interaction.reply({
      content: "その人には投票できません。",
      ephemeral: true,
    });
    return;
  }

  game.votes.set(voter.id, targetId);
  await interaction.reply({
    content: "投票を受け付けました。",
    ephemeral: true,
  });
  await updateVoteProgress(game);

  if (game.votes.size >= alivePlayers(game).length)
    queueVoteResolutionAfterMinimum(game);
}

function queueVoteResolutionAfterMinimum(game: GameState): void {
  if (game.resolving || game.resolutionQueued) return;
  const delayMs = remainingPhaseMinimumMs(
    game.phaseStartedAt,
    VOTE_MIN_SECONDS,
  );
  if (delayMs > 0) {
    game.resolutionQueued = true;
    schedule(game, delayMs, () => {
      game.resolutionQueued = false;
      return queueVoteResolution(game);
    });
    return;
  }
  runGameTask("Vote resolution", () => queueVoteResolution(game));
}

async function queueVoteResolution(game: GameState): Promise<void> {
  if (!isActiveGame(game) || game.phase !== "voting" || game.resolving) return;
  const delayMs = remainingPhaseMinimumMs(
    game.phaseStartedAt,
    VOTE_MIN_SECONDS,
  );
  if (delayMs > 0) {
    if (game.resolutionQueued) return;
    game.resolutionQueued = true;
    schedule(game, delayMs, () => {
      game.resolutionQueued = false;
      return queueVoteResolution(game);
    });
    return;
  }
  game.resolving = true;
  game.resolutionQueued = false;
  clearGameTimers(game);
  const revealSeconds = VOTE_REVEAL_SECONDS;
  game.phaseEndsAt = Date.now() + revealSeconds * 1000;
  if (
    !(await updateOrReplacePhasePanel(game, {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${game.day}日目｜投票終了`)
          .setDescription(
            `投票を締め切りました。\n\n${progressBar(game.votes.size, alivePlayers(game).length)}\n結果を集計しています…`,
          )
          .setColor(COLORS.vote),
      ],
      components: [],
    }))
  )
    return;
  schedule(game, revealSeconds * 1000, () => revealVoteResult(game));
}

async function revealVoteResult(game: GameState): Promise<void> {
  if (!isActiveGame(game) || game.phase !== "voting" || !game.resolving) return;
  clearGameTimers(game);
  const holdSeconds = RESULT_HOLD_SECONDS;
  recordCurrentVoteRound(game);

  const living = alivePlayers(game);
  const outcome = resolveVoteOutcome(
    weightedVoteTargetIds(game),
    game.voteRound,
  );

  if (outcome.kind === "revote") {
    game.phaseEndsAt = Date.now() + holdSeconds * 1000;
    const tied = living.filter((player) =>
      outcome.candidateIds.includes(player.id),
    );
    if (
      !(await updateOrReplacePhasePanel(game, {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${game.day}日目｜同票`)
            .setDescription(
              `${playerNameRows(tied)} が同票でした。\n\n再投票を行います。`,
            )
            .addFields(
              { name: "得票数", value: voteTallyRows(game) },
              ...voteBallotFields(game),
            )
            .setColor(COLORS.vote),
        ],
        components: [],
      }))
    )
      return;
    schedule(game, holdSeconds * 1000, () => {
      game.voteRound = 2;
      game.voteCandidateIds = outcome.candidateIds;
      return beginVoting(game);
    });
    return;
  }

  if (outcome.kind === "no-execution") {
    game.lastExecuted = undefined;
    game.phaseEndsAt = Date.now() + holdSeconds * 1000;
    const noExecutionText = outcome.candidateIds.length
      ? "同票のため、本日の処刑はありません。"
      : "投票が集まらなかったため、本日の処刑はありません。";
    if (
      !(await updateOrReplacePhasePanel(game, {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${game.day}日目｜投票結果`)
            .setDescription(noExecutionText)
            .addFields(
              { name: "得票数", value: voteTallyRows(game) },
              ...voteBallotFields(game),
            )
            .setColor(COLORS.vote),
        ],
        components: [],
      }))
    )
      return;
    schedule(game, holdSeconds * 1000, () => startNight(game));
    return;
  }

  const executed = game.players.find(
    (player) => player.id === outcome.targetId,
  );
  if (!executed) return;

  const deaths: Player[] = [];
  eliminateWithLovers(game, executed, deaths);
  if (executed.role === "猫又") {
    const candidates = alivePlayers(game);
    if (candidates.length > 0) {
      eliminateWithLovers(game, randomItem(candidates), deaths);
    }
  }
  game.lastExecuted = executed;
  game.executionHistory.push(executed);
  const winner = executed.role === "てるてる" ? "teruteru" : winnerFor(game);
  game.phaseEndsAt = Date.now() + holdSeconds * 1000;
  if (
    !(await updateOrReplacePhasePanel(game, {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${game.day}日目｜投票結果`)
          .setDescription(
            `村の決定により、**${safeName(executed)}** が処刑されました。${
              deaths.length > 1
                ? `\n${deaths
                    .slice(1)
                    .map(
                      (player) =>
                        `**${safeName(player)}** が道連れになりました。`,
                    )
                    .join("\n")}`
                : ""
            }`,
          )
          .addFields(
            { name: "得票数", value: voteTallyRows(game) },
            ...voteBallotFields(game),
          )
          .setColor(COLORS.danger),
      ],
      components: [],
    }))
  )
    return;
  schedule(game, holdSeconds * 1000, () => {
    return winner ? endGame(game, winner) : startNight(game);
  });
}

function nightActionKey(action: string, playerId: string): string {
  return `${action}:${playerId}`;
}

export function livingHumanWolfAllies(
  game: Pick<GameState, "players">,
  playerId: string,
): Player[] {
  return game.players.filter(
    (player) =>
      player.id !== playerId &&
      player.alive &&
      !player.isNpc &&
      isActualWolfRole(player.role),
  );
}

export function remainingWolfChatMessages(
  game: Pick<GameState, "wolfChatCounts">,
  playerId: string,
): number {
  return Math.max(
    0,
    WOLF_CHAT_MESSAGES_PER_NIGHT - (game.wolfChatCounts.get(playerId) ?? 0),
  );
}

export function wolfChatButtonRow(
  game: GameState,
  player: Player,
): ActionRowBuilder<ButtonBuilder> | undefined {
  if (
    !player.alive ||
    player.isNpc ||
    !isActualWolfRole(player.role) ||
    livingHumanWolfAllies(game, player.id).length === 0
  )
    return undefined;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId("wolf-chat-open", game))
      .setLabel("人狼会議")
      .setEmoji("🐺")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function isTargetGuarded(
  game: Pick<GameState, "players" | "nightChoices">,
  targetId: string | undefined,
): boolean {
  if (!targetId) return false;
  return game.players.some(
    (player) =>
      player.alive &&
      player.role === "騎士" &&
      game.nightChoices.get(nightActionKey("guard", player.id)) === targetId,
  );
}

export function recordNightHistory(
  game: GameState,
  attackTargetId: string | undefined,
  guarded: boolean,
  deathIds: string[] = [],
): void {
  const choicesFor = (action: string, role: RoleName) =>
    game.players.flatMap((player) => {
      if (!player.alive || player.role !== role) return [];
      const targetId = game.nightChoices.get(nightActionKey(action, player.id));
      return targetId ? [{ actorId: player.id, targetId }] : [];
    });
  const wolfChoices = game.players.flatMap((player) => {
    if (!player.alive || !isActualWolfRole(player.role)) return [];
    const targetId = game.nightChoices.get(nightActionKey("kill", player.id));
    return targetId ? [{ actorId: player.id, targetId }] : [];
  });
  const entry = {
    day: game.day,
    wolfChoices,
    guardChoices: choicesFor("guard", "騎士"),
    seerChoices: choicesFor("seer", "占い師"),
    specialChoices: [...game.nightChoices.entries()].flatMap(
      ([key, targetValue]) => {
        const separator = key.indexOf(":");
        const action = key.slice(0, separator);
        const actorId = key.slice(separator + 1);
        if (
          ["kill", "guard", "seer"].includes(action) ||
          targetValue === "skip"
        )
          return [];
        return [{ action, actorId, targetIds: targetValue.split(",") }];
      },
    ),
    attackTargetId,
    victimId: deathIds.includes(attackTargetId ?? "")
      ? attackTargetId
      : undefined,
    deathIds,
    guarded,
  };
  const existingIndex = game.nightHistory.findIndex(
    (record) => record.day === game.day,
  );
  if (existingIndex >= 0) game.nightHistory[existingIndex] = entry;
  else game.nightHistory.push(entry);
}

type NightAction =
  | "kill"
  | "seer"
  | "guard"
  | "flee"
  | "assassinate"
  | "sorcery"
  | "divide"
  | "compass"
  | "cupid"
  | "devotee"
  | "thief";

const NIGHT_ACTION_ROLE: Record<Exclude<NightAction, "kill">, RoleName> = {
  seer: "占い師",
  guard: "騎士",
  flee: "逃亡者",
  assassinate: "暗殺者",
  sorcery: "妖術師",
  divide: "分断者",
  compass: "方位磁針",
  cupid: "キューピッド",
  devotee: "純愛者",
  thief: "怪盗",
};

function powerUsedKey(action: NightAction, playerId: string): string {
  return `${action}:${playerId}`;
}

export function nightActionForPlayer(
  game: GameState,
  player: Player,
): NightAction | undefined {
  if (isActualWolfRole(player.role)) return "kill";
  const role = player.role;
  if (!role) return undefined;
  const action = (
    Object.entries(NIGHT_ACTION_ROLE) as Array<
      [Exclude<NightAction, "kill">, RoleName]
    >
  ).find(([, requiredRole]) => requiredRole === role)?.[0];
  if (!action) return undefined;
  if (["cupid", "devotee", "thief"].includes(action) && game.day !== 1)
    return undefined;
  if (action === "compass" && game.day < 2) return undefined;
  if (
    ["assassinate", "divide", "compass", "cupid", "devotee", "thief"].includes(
      action,
    ) &&
    usedRolePowers(game).has(powerUsedKey(action, player.id))
  )
    return undefined;
  return action;
}

function nightTargets(
  game: GameState,
  player: Player,
  action: NightAction,
): Player[] {
  const living = alivePlayers(game);
  if (action === "kill")
    return living.filter((target) => !isActualWolfRole(target.role));
  if (action === "cupid") return living;
  if (action === "divide")
    return living.filter(
      (target) => target.id !== player.id && !isActualWolfRole(target.role),
    );
  return living.filter((target) => target.id !== player.id);
}

function expectedNightActions(game: GameState): string[] {
  const expected: string[] = [];
  for (const player of alivePlayers(game)) {
    const action = nightActionForPlayer(game, player);
    if (action) expected.push(nightActionKey(action, player.id));
  }
  return expected;
}

async function sendNightMenu(
  game: GameState,
  player: Player,
  action: NightAction,
  prompt: string,
  targets: Player[],
  options: { targetCount?: number; allowSkip?: boolean } = {},
): Promise<boolean> {
  if (
    !isActiveGame(game) ||
    player.isNpc ||
    !player.user ||
    targets.length === 0
  )
    return false;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(componentId(`night-${action}`, game))
    .setPlaceholder(prompt)
    .setMinValues(options.targetCount ?? 1)
    .setMaxValues(options.targetCount ?? 1)
    .addOptions([
      ...playerOptions(targets),
      ...(options.allowSkip
        ? [{ label: "今夜は能力を使わない", value: "skip", emoji: "⏭️" }]
        : []),
    ]);

  const components: Array<
    ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
  > = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
  const chatRow =
    action === "kill" ? wolfChatButtonRow(game, player) : undefined;
  if (chatRow) components.push(chatRow);

  try {
    const message = await player.user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            `🌙 夜の行動｜${
              (
                {
                  kill: "襲撃",
                  seer: "占い",
                  guard: "護衛",
                  flee: "逃亡",
                  assassinate: "暗殺",
                  sorcery: "妖術",
                  divide: "分断",
                  compass: "方位磁針",
                  cupid: "恋人選択",
                  devotee: "想い人選択",
                  thief: "役職を盗む",
                } satisfies Record<NightAction, string>
              )[action]
            }`,
          )
          .setDescription(
            chatRow
              ? `${prompt}\n\n「人狼会議」から、生存中の人狼仲間だけに短文を送れます。`
              : prompt,
          )
          .setColor(COLORS.night),
      ],
      components,
    });
    if (!isActiveGame(game)) {
      await message.edit({ components: [] }).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

function activeHumanWolf(game: GameState, userId: string): Player | undefined {
  return game.players.find(
    (player) =>
      player.id === userId &&
      player.alive &&
      !player.isNpc &&
      isActualWolfRole(player.role),
  );
}

export function wolfChatRelayPayload(
  game: GameState,
  actor: Player,
  message: string,
): MessageCreateOptions {
  return {
    allowedMentions: { parse: [] },
    embeds: [
      new EmbedBuilder()
        .setTitle(`🐺 人狼会議｜${game.day}日目`)
        .setDescription(`**${safeName(actor)}**\n${escapeMarkdown(message)}`)
        .setColor(COLORS.danger),
    ],
  };
}

async function handleWolfChatOpen(
  interaction: ButtonInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const actor = activeHumanWolf(game, interaction.user.id);
  const allies = actor ? livingHumanWolfAllies(game, actor.id) : [];
  if (
    game.phase !== "night" ||
    game.resolving ||
    game.day !== day ||
    !actor ||
    allies.length === 0
  ) {
    await interaction.reply({
      content: "現在は人狼会議を利用できません。",
    });
    return;
  }
  if (remainingWolfChatMessages(game, actor.id) === 0) {
    await interaction.reply({
      content: "今夜送れる人狼会議のメッセージは使い切りました。",
    });
    return;
  }

  const input = new TextInputBuilder()
    .setCustomId("message")
    .setLabel("仲間へのメッセージ（100文字まで）")
    .setPlaceholder("例：今夜はアカネを襲撃したい")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(100)
    .setRequired(true);
  const modal = new ModalBuilder()
    .setCustomId(componentId("wolf-chat-submit", game))
    .setTitle(`人狼会議｜${game.day}日目`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
  await interaction.showModal(modal);
}

async function handleWolfChatSubmit(
  interaction: ModalSubmitInteraction,
  game: GameState,
  day: number,
): Promise<void> {
  const actor = activeHumanWolf(game, interaction.user.id);
  const allies = actor ? livingHumanWolfAllies(game, actor.id) : [];
  const message = interaction.fields
    .getTextInputValue("message")
    .replaceAll("\u0000", "")
    .trim()
    .slice(0, 100);
  if (
    game.phase !== "night" ||
    game.resolving ||
    game.day !== day ||
    !actor ||
    allies.length === 0 ||
    !message
  ) {
    await interaction.reply({
      content: "この人狼会議のメッセージは送信できませんでした。",
    });
    return;
  }
  const remaining = remainingWolfChatMessages(game, actor.id);
  if (remaining === 0) {
    await interaction.reply({
      content: "今夜送れる人狼会議のメッセージは使い切りました。",
    });
    return;
  }

  await interaction.deferReply();
  const currentActor = activeHumanWolf(game, interaction.user.id);
  const currentAllies = currentActor
    ? livingHumanWolfAllies(game, currentActor.id)
    : [];
  if (
    !isActiveGame(game) ||
    game.phase !== "night" ||
    game.resolving ||
    game.day !== day ||
    !currentActor ||
    currentAllies.length === 0 ||
    remainingWolfChatMessages(game, currentActor.id) === 0
  ) {
    await interaction.editReply({
      content: "夜が終了したため、人狼会議のメッセージは送信しませんでした。",
    });
    return;
  }
  game.wolfChatCounts.set(
    currentActor.id,
    (game.wolfChatCounts.get(currentActor.id) ?? 0) + 1,
  );
  const delivered = (
    await Promise.all(
      currentAllies.map(async (ally) => {
        if (!ally.user) return false;
        return ally.user
          .send(wolfChatRelayPayload(game, currentActor, message))
          .then(() => true)
          .catch(() => false);
      }),
    )
  ).filter(Boolean).length;
  const remainingAfterSend = remainingWolfChatMessages(game, currentActor.id);
  await interaction.editReply({
    content:
      delivered === currentAllies.length
        ? `仲間${delivered}人に送りました。今夜はあと${remainingAfterSend}回送れます。`
        : `仲間${delivered}/${currentAllies.length}人に送りました。DMを受け取れない仲間がいます。今夜はあと${remainingAfterSend}回送れます。`,
  });
}

export function privateDeliveryWarning(
  kind: "result" | "night-action",
): string {
  return kind === "result"
    ? "一部のプレイヤーに個別結果のDMを送れませんでした。サーバーメンバーからのDM設定を確認してください。"
    : "一部のプレイヤーに夜行動DMを送れなかったため、自動で選択しました。サーバーメンバーからのDM設定を確認してください。";
}

function queuePrivateNotice(
  game: GameState,
  playerId: string,
  message: string,
): void {
  const messages = game.pendingDmMessages.get(playerId) ?? [];
  messages.push(message);
  game.pendingDmMessages.set(playerId, messages);
}

async function flushPendingDmMessages(game: GameState): Promise<void> {
  for (const [playerId, messages] of game.pendingDmMessages) {
    const player = game.players.find((candidate) => candidate.id === playerId);
    if (!player?.user || messages.length === 0) continue;
    const sent = await player.user
      .send(`📨 未送信だった結果\n${messages.join("\n")}`)
      .then(() => true)
      .catch(() => false);
    if (sent) game.pendingDmMessages.delete(playerId);
  }
}

export function mediumResultRecipients(
  game: Pick<GameState, "players">,
): Player[] {
  return game.players.filter(
    (player) => player.alive && !player.isNpc && player.role === "霊能者",
  );
}

export async function sendMediumResults(game: GameState): Promise<void> {
  if (!game.lastExecuted) return;
  const executed = game.lastExecuted;
  const result = publicResultForRole(executed.role);
  const failed = (
    await Promise.all(
      mediumResultRecipients(game).map(async (medium) => {
        const sent = medium.user
          ? await medium.user
              .send({
                embeds: [
                  new EmbedBuilder()
                    .setTitle("👻 霊能結果")
                    .setDescription(
                      `**${safeName(executed)}** は **${result}** でした。`,
                    )
                    .setColor(COLORS.night),
                ],
              })
              .then(() => true)
              .catch(() => false)
          : false;
        return sent ? undefined : medium;
      }),
    )
  ).filter((medium): medium is Player => medium !== undefined);

  for (const medium of failed) {
    queuePrivateNotice(
      game,
      medium.id,
      `霊能結果：**${safeName(executed)}** は **${result}** でした。`,
    );
  }
  if (failed.length > 0) {
    await game.channel.send(privateDeliveryWarning("result")).catch((error) => {
      console.error("Private result warning failed:", error);
    });
  }
}

function automaticNightNotice(
  game: GameState,
  player: Player,
  action: NightAction,
): string {
  const targetId = game.nightChoices.get(nightActionKey(action, player.id));
  if (targetId === "skip") return "今夜は能力を使いませんでした。";
  const targetIds = targetId?.split(",") ?? [];
  const targets = targetIds.flatMap((id) => {
    const target = game.players.find((candidate) => candidate.id === id);
    return target ? [target] : [];
  });
  const target = targets[0];
  if (!target) return "夜行動は対象を選べず、見送りになりました。";
  if (action === "seer") {
    return `占いは **${safeName(target)}** が自動選択され、結果は **${publicResultForRole(target.role)}** でした。`;
  }
  if (action === "sorcery")
    return `妖術は **${safeName(target)}** が自動選択され、正体は **${target.role}** でした。`;
  if (action === "compass" && targets.length === 2)
    return `方位磁針は **${safeName(targets[0])}** と **${safeName(targets[1])}** を自動選択しました。`;
  const labels: Record<NightAction, string> = {
    kill: "襲撃",
    seer: "占い",
    guard: "護衛",
    flee: "逃亡先",
    assassinate: "暗殺",
    sorcery: "妖術",
    divide: "分断対象",
    compass: "方位磁針",
    cupid: "恋人",
    devotee: "想い人",
    thief: "怪盗の対象",
  };
  return `${labels[action]}は **${targets.map(safeName).join("** と **")}** が自動選択されました。`;
}

function strategicNightTarget(
  game: GameState,
  action: "kill" | "guard",
  targets: Player[],
): Player | undefined {
  return chooseStrategicNightTarget(action, targets, (playerId) =>
    claimedRoleForPlayer(game, playerId),
  );
}

function setNpcNightChoices(game: GameState): void {
  const living = alivePlayers(game);
  const wolfTargets = living.filter((player) => !isActualWolfRole(player.role));
  const sharedWolfTarget = strategicNightTarget(game, "kill", wolfTargets);
  for (const npc of living.filter((player) => player.isNpc)) {
    const action = nightActionForPlayer(game, npc);
    if (!action) continue;
    if (action === "kill") {
      if (sharedWolfTarget)
        game.nightChoices.set(
          nightActionKey("kill", npc.id),
          sharedWolfTarget.id,
        );
    } else if (action === "seer") {
      const target = nextNpcSeerTarget(game, npc);
      if (target) {
        game.nightChoices.set(nightActionKey("seer", npc.id), target.id);
        recordSeerResult(game, npc.id, target);
      }
    } else if (action === "guard") {
      const targets = living.filter((player) => player.id !== npc.id);
      const target = strategicNightTarget(game, "guard", targets);
      if (target)
        game.nightChoices.set(nightActionKey("guard", npc.id), target.id);
    } else if (action === "assassinate") {
      const targets = nightTargets(game, npc, action);
      const shouldUse = game.day >= 2 && Math.random() < 0.25;
      game.nightChoices.set(
        nightActionKey(action, npc.id),
        shouldUse && targets.length ? randomItem(targets).id : "skip",
      );
    } else if (action === "divide") {
      const targets = nightTargets(game, npc, action);
      const shouldUse = game.day >= 2 && Math.random() < 0.3;
      game.nightChoices.set(
        nightActionKey(action, npc.id),
        shouldUse && targets.length ? randomItem(targets).id : "skip",
      );
    } else {
      fillMissingNightAction(game, npc, action);
    }
  }
}

export function fillMissingNightAction(
  game: GameState,
  player: Player,
  action: NightAction,
): void {
  const key = nightActionKey(action, player.id);
  if (game.nightChoices.has(key)) return;
  if (action === "seer") {
    const target = nextNpcSeerTarget(game, player);
    if (target) {
      game.nightChoices.set(key, target.id);
      recordSeerResult(game, player.id, target);
    }
    return;
  }
  if (action === "assassinate" || action === "divide") {
    game.nightChoices.set(key, "skip");
    return;
  }
  const targets = nightTargets(game, player, action);
  if ((action === "cupid" || action === "compass") && targets.length >= 2) {
    const first = randomItem(targets);
    const second = randomItem(
      targets.filter((target) => target.id !== first.id),
    );
    game.nightChoices.set(key, `${first.id},${second.id}`);
    return;
  }
  const target =
    action === "kill" || action === "guard"
      ? strategicNightTarget(game, action, targets)
      : targets.length
        ? randomItem(targets)
        : undefined;
  if (target) game.nightChoices.set(key, target.id);
}

export function autoSelectHumanSeer(
  game: GameState,
  player: Player,
): string | undefined {
  const key = nightActionKey("seer", player.id);
  if (
    game.phase !== "night" ||
    !player.alive ||
    player.isNpc ||
    player.role !== "占い師" ||
    game.nightChoices.has(key)
  )
    return undefined;
  fillMissingNightAction(game, player, "seer");
  return game.nightChoices.has(key)
    ? automaticNightNotice(game, player, "seer")
    : undefined;
}

async function autoCompleteHumanSeer(
  game: GameState,
  player: Player,
): Promise<void> {
  const notice = autoSelectHumanSeer(game, player);
  if (!notice) return;
  const sent = player.user
    ? await player.user.send(`⏱️ おまかせ占い\n${notice}`).then(
        () => true,
        () => false,
      )
    : false;
  if (!isActiveGame(game) || game.phase !== "night" || game.resolving) return;
  if (!sent) queuePrivateNotice(game, player.id, notice);
  if (expectedNightActions(game).every((key) => game.nightChoices.has(key)))
    queueNightResolutionAfterMinimum(game);
}

function fillAllMissingNightActions(game: GameState): void {
  for (const player of alivePlayers(game)) {
    const action = nightActionForPlayer(game, player);
    if (action) fillMissingNightAction(game, player, action);
  }
}

async function startNight(game: GameState): Promise<void> {
  if (!isActiveGame(game)) return;
  clearGameTimers(game);
  game.phase = "night";
  game.nightChoices.clear();
  game.wolfChatCounts.clear();
  game.resolving = false;
  game.resolutionQueued = false;
  game.phaseStartedAt = Date.now();
  const nightSeconds = NIGHT_SECONDS;
  const seerAutoSeconds = SEER_AUTO_SECONDS;
  game.phaseEndsAt = Date.now() + nightSeconds * 1000;

  const nightPayload = {
    content: "",
    embeds: [nightEmbed(game)],
    components: [],
  };
  if (!(await openPhasePanel(game, nightPayload))) return;
  // 個別DMや補助通知が失敗・遅延しても、夜そのものは必ず締め切る。
  schedule(game, nightSeconds * 1000, () => queueNightResolution(game));

  await sendMediumResults(game);
  if (!isActiveGame(game) || game.phase !== "night" || game.resolving) return;

  const living = alivePlayers(game);
  setNpcNightChoices(game);
  let nightDmFailureCount = 0;
  await Promise.all(
    living.map(async (player) => {
      if (player.isNpc) return;
      const action = nightActionForPlayer(game, player);
      if (!action) return;
      const prompt: Record<NightAction, string> = {
        kill: "襲撃する人を選んでください。",
        seer: `${seerAutoSeconds}秒以内に選ばなければ、未占いの相手から自動で占います。`,
        guard: "守る人を選んでください。同じ相手も続けて護衛できます。",
        flee: "今夜、逃げ込む相手を選んでください。",
        assassinate: "一度だけ暗殺できます。使わないこともできます。",
        sorcery: "正体を見抜く相手を選んでください。",
        divide: "翌日の議論を分断する対象を選ぶか、今夜は見送ってください。",
        compass: "陣営を比較する2人を選んでください。",
        cupid: "恋人にする2人を選んでください。自分を含めても構いません。",
        devotee: "想い人を1人選んでください。",
        thief: "役職を盗む相手を1人選んでください。",
      };
      const sent = await sendNightMenu(
        game,
        player,
        action,
        prompt[action],
        nightTargets(game, player, action),
        {
          targetCount: action === "cupid" || action === "compass" ? 2 : 1,
          allowSkip: action === "assassinate" || action === "divide",
        },
      );
      if (!sent) {
        fillMissingNightAction(game, player, action);
        queuePrivateNotice(
          game,
          player.id,
          automaticNightNotice(game, player, action),
        );
        nightDmFailureCount += 1;
      }
    }),
  );
  if (!isActiveGame(game) || game.phase !== "night" || game.resolving) return;
  if (nightDmFailureCount > 0) {
    await game.channel
      .send(privateDeliveryWarning("night-action"))
      .catch((error) => {
        console.error("Night action warning failed:", error);
      });
  }

  for (const seer of living.filter(
    (player) => !player.isNpc && player.role === "占い師",
  )) {
    schedule(game, seerAutoSeconds * 1000, () =>
      autoCompleteHumanSeer(game, seer),
    );
  }

  if (expectedNightActions(game).every((key) => game.nightChoices.has(key))) {
    queueNightResolutionAfterMinimum(game);
  }
}

async function handleNightAction(
  interaction: StringSelectMenuInteraction,
  game: GameState,
  action: NightAction,
  day: number,
): Promise<void> {
  const actor = game.players.find(
    (player) => player.id === interaction.user.id,
  );
  if (
    game.phase !== "night" ||
    game.resolving ||
    game.day !== day ||
    !actor?.alive ||
    nightActionForPlayer(game, actor) !== action
  ) {
    await interaction.reply({
      content: "この夜行動は現在使用できません。",
      ephemeral: true,
    });
    return;
  }

  const actionKey = nightActionKey(action, actor.id);
  if (
    (action === "seer" || action === "sorcery" || action === "compass") &&
    game.nightChoices.has(actionKey)
  ) {
    await interaction.reply({
      content: "今夜の結果確認はすでに確定しています。",
      ephemeral: true,
    });
    return;
  }

  if (interaction.values[0] === "skip") {
    if (action !== "assassinate" && action !== "divide") {
      await interaction.reply({
        content: "この能力は見送れません。",
        ephemeral: true,
      });
      return;
    }
    game.nightChoices.set(actionKey, "skip");
    await interaction.update({
      content: "今夜は能力を使いません。",
      components: [],
    });
    if (expectedNightActions(game).every((key) => game.nightChoices.has(key)))
      queueNightResolutionAfterMinimum(game);
    return;
  }

  const expectedTargetCount =
    action === "cupid" || action === "compass" ? 2 : 1;
  const targetIds = [...new Set(interaction.values)];
  const allowedIds = new Set(
    nightTargets(game, actor, action).map((target) => target.id),
  );
  const targets = targetIds.flatMap((targetId) => {
    const target = game.players.find(
      (player) => player.id === targetId && player.alive,
    );
    return target ? [target] : [];
  });
  if (
    targets.length !== expectedTargetCount ||
    targets.some((target) => !allowedIds.has(target.id))
  ) {
    await interaction.reply({
      content: "対象を選び直してください。",
      ephemeral: true,
    });
    return;
  }

  const target = targets[0];
  game.nightChoices.set(actionKey, targets.map((item) => item.id).join(","));

  if (action === "seer") {
    recordSeerResult(game, actor.id, target);
    const result = publicResultForRole(target.role);
    await interaction.update({
      content: `🔮 **${safeName(target)}** は **${result}** です。`,
      components: [],
    });
  } else if (action === "sorcery") {
    await interaction.update({
      content: `🪄 **${safeName(target)}** の正体は **${target.role}** です。`,
      components: [],
    });
  } else if (action === "compass") {
    const sameTeam =
      effectivePlayerTeam(game, targets[0]) ===
      effectivePlayerTeam(game, targets[1]);
    await interaction.update({
      content: `🧭 **${safeName(targets[0])}** と **${safeName(targets[1])}** は **${sameTeam ? "同じ陣営" : "別陣営"}** です。`,
      components: [],
    });
  } else {
    await interaction.update({
      content: `選択しました：**${targets.map(safeName).join("** と **")}**\n締切までは変更できます。`,
      components: interaction.message.components.map((row) => row.toJSON()),
    });
  }

  if (expectedNightActions(game).every((key) => game.nightChoices.has(key)))
    queueNightResolutionAfterMinimum(game);
}

function queueNightResolutionAfterMinimum(game: GameState): void {
  if (game.resolving || game.resolutionQueued) return;
  const delayMs = remainingPhaseMinimumMs(
    game.phaseStartedAt,
    NIGHT_MIN_SECONDS,
  );
  if (delayMs > 0) {
    game.resolutionQueued = true;
    schedule(game, delayMs, () => {
      game.resolutionQueued = false;
      return queueNightResolution(game);
    });
    return;
  }
  runGameTask("Night resolution", () => queueNightResolution(game));
}

async function queueNightResolution(game: GameState): Promise<void> {
  if (!isActiveGame(game) || game.phase !== "night" || game.resolving) return;
  const delayMs = remainingPhaseMinimumMs(
    game.phaseStartedAt,
    NIGHT_MIN_SECONDS,
  );
  if (delayMs > 0) {
    if (game.resolutionQueued) return;
    game.resolutionQueued = true;
    schedule(game, delayMs, () => {
      game.resolutionQueued = false;
      return queueNightResolution(game);
    });
    return;
  }
  game.resolving = true;
  game.resolutionQueued = false;
  fillAllMissingNightActions(game);
  clearGameTimers(game);
  const revealSeconds = NIGHT_REVEAL_SECONDS;
  game.phaseEndsAt = Date.now() + revealSeconds * 1000;
  if (
    !(await updateOrReplacePhasePanel(game, {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${game.day}日目｜夜明け前`)
          .setDescription(
            "夜の行動がすべて終わりました。\nまもなく朝になります。",
          )
          .setColor(COLORS.night),
      ],
      components: [],
    }))
  )
    return;
  schedule(game, revealSeconds * 1000, () => revealNightResult(game));
}

async function sendPrivateText(
  game: GameState,
  player: Player | undefined,
  text: string,
): Promise<void> {
  if (!player || player.isNpc) return;
  const sent = player.user
    ? await player.user.send(text).then(
        () => true,
        () => false,
      )
    : false;
  if (!sent) queuePrivateNotice(game, player.id, text);
}

async function resolveRelationshipAndUtilityActions(
  game: GameState,
): Promise<void> {
  const choice = (action: NightAction, player: Player) =>
    game.nightChoices.get(nightActionKey(action, player.id));

  for (const cupid of game.players.filter(
    (player) => player.alive && player.role === "キューピッド",
  )) {
    const selected = choice("cupid", cupid)?.split(",") ?? [];
    if (selected.length !== 2) continue;
    const [left, right] = selected;
    if (
      loverPairs(game).some((pair) =>
        pair.some((playerId) => playerId === left || playerId === right),
      )
    )
      continue;
    loverPairs(game).push([left, right]);
    usedRolePowers(game).add(powerUsedKey("cupid", cupid.id));
    const leftPlayer = game.players.find((player) => player.id === left);
    const rightPlayer = game.players.find((player) => player.id === right);
    await Promise.all([
      sendPrivateText(
        game,
        leftPlayer,
        `💘 あなたは **${rightPlayer ? safeName(rightPlayer) : "不明"}** と恋人になりました。相手が死亡すると、あなたも後を追います。`,
      ),
      sendPrivateText(
        game,
        rightPlayer,
        `💘 あなたは **${leftPlayer ? safeName(leftPlayer) : "不明"}** と恋人になりました。相手が死亡すると、あなたも後を追います。`,
      ),
    ]);
  }

  for (const devotee of game.players.filter(
    (player) => player.alive && player.role === "純愛者",
  )) {
    const targetId = choice("devotee", devotee);
    if (!targetId) continue;
    devoteeTargets(game).set(devotee.id, targetId);
    usedRolePowers(game).add(powerUsedKey("devotee", devotee.id));
  }

  for (const divider of game.players.filter(
    (player) => player.alive && player.role === "分断者",
  )) {
    const targetId = choice("divide", divider);
    if (!targetId || targetId === "skip") continue;
    game.pendingDivision = {
      dividerId: divider.id,
      targetId,
      day: game.day + 1,
    };
    usedRolePowers(game).add(powerUsedKey("divide", divider.id));
  }

  for (const compass of game.players.filter(
    (player) => player.alive && player.role === "方位磁針",
  )) {
    if (!choice("compass", compass)) continue;
    usedRolePowers(game).add(powerUsedKey("compass", compass.id));
  }

  for (const thief of game.players.filter(
    (player) => player.alive && player.role === "怪盗",
  )) {
    const targetId = choice("thief", thief);
    const target = game.players.find((player) => player.id === targetId);
    if (!target?.role) continue;
    const stolenRole = target.role;
    target.role = "村人";
    thief.role = stolenRole;
    usedRolePowers(game).add(powerUsedKey("thief", thief.id));
    await sendPrivateText(
      game,
      thief,
      `🥷 **${safeName(target)}** から **${stolenRole}** を盗みました。あなたは今から **${stolenRole}** です。`,
    );
    await sendPrivateText(
      game,
      target,
      "🥷 何者かに役職を盗まれました。あなたは今から **村人** です。",
    );
  }
}

async function sendCoronerReports(
  game: GameState,
  deaths: Player[],
): Promise<void> {
  if (deaths.length === 0) return;
  const report = deaths
    .map((player) => `・**${safeName(player)}**｜**${player.role}**`)
    .join("\n");
  await Promise.all(
    game.players
      .filter(
        (player) => player.alive && player.role === "検死官" && !player.isNpc,
      )
      .map((coroner) =>
        sendPrivateText(game, coroner, `🩺 **検死結果**\n${report}`),
      ),
  );
}

async function revealNightResult(game: GameState): Promise<void> {
  if (!isActiveGame(game) || game.phase !== "night" || !game.resolving) return;
  clearGameTimers(game);
  const holdSeconds = RESULT_HOLD_SECONDS;

  const living = alivePlayers(game);
  const wolves = living.filter((player) => isActualWolfRole(player.role));
  const possibleVictims = living.filter(
    (player) => !isActualWolfRole(player.role),
  );
  const victimId = resolveWolfTarget(
    wolves,
    game.nightChoices,
    possibleVictims,
  );
  const victim = game.players.find((player) => player.id === victimId);

  const wasGuarded = isTargetGuarded(game, victim?.id);
  const previousFatalWounds = new Set(fatalWoundIds(game));
  const deaths: Player[] = [];
  await resolveRelationshipAndUtilityActions(game);

  let attackKilled: Player | undefined;
  if (victim && !wasGuarded) {
    if (victim.role === "妖狐") {
      // 妖狐は襲撃では死亡しない。
    } else if (victim.role === "呪われた村人") {
      victim.role = "人狼";
      const wolfAllies = alivePlayers(game).filter(
        (player) => isActualWolfRole(player.role) && player.id !== victim.id,
      );
      await sendPrivateText(
        game,
        victim,
        `🩸 呪いが発動しました。あなたは襲撃で死亡せず、**人狼** に変化しました。${wolfAllies.length ? `\n仲間の人狼：${wolfAllies.map(safeName).join("、")}` : ""}`,
      );
      await Promise.all(
        wolfAllies.map((wolf) =>
          sendPrivateText(
            game,
            wolf,
            `🐺 **${safeName(victim)}** が呪いにより新しい人狼になりました。`,
          ),
        ),
      );
    } else if (victim.role === "タフガイ") {
      fatalWoundIds(game).add(victim.id);
      await sendPrivateText(
        game,
        victim,
        "💪 人狼の襲撃に耐えました。しかし傷は深く、次の夜に死亡します。",
      );
    } else if (victim.role !== "逃亡者") {
      eliminateWithLovers(game, victim, deaths);
      attackKilled = victim;
    }
  }

  for (const playerId of previousFatalWounds) {
    const player = game.players.find((candidate) => candidate.id === playerId);
    eliminateWithLovers(game, player, deaths);
    fatalWoundIds(game).delete(playerId);
  }

  for (const choiceEntry of [...game.nightChoices.entries()]) {
    const [key, targetValue] = choiceEntry;
    const [action, actorId] = key.split(":") as [NightAction, string];
    if (action === "seer") {
      const target = game.players.find((player) => player.id === targetValue);
      if (target?.role === "妖狐") eliminateWithLovers(game, target, deaths);
    }
    if (action === "assassinate" && targetValue !== "skip") {
      const assassin = game.players.find((player) => player.id === actorId);
      const target = game.players.find((player) => player.id === targetValue);
      if (!assassin || !target) continue;
      usedRolePowers(game).add(powerUsedKey(action, assassin.id));
      const friendlyFire =
        target.role !== undefined && ROLE_INFO[target.role].team === "villager";
      eliminateWithLovers(game, target, deaths);
      if (friendlyFire) eliminateWithLovers(game, assassin, deaths);
    }
  }

  for (const fugitive of game.players.filter(
    (player) => player.alive && player.role === "逃亡者",
  )) {
    const hostId = game.nightChoices.get(nightActionKey("flee", fugitive.id));
    const host = game.players.find((player) => player.id === hostId);
    if (isActualWolfRole(host?.role) || host?.id === attackKilled?.id) {
      eliminateWithLovers(game, fugitive, deaths);
    }
  }

  for (const wolf of game.players.filter(
    (player) => player.alive && player.role === "饒舌な人狼",
  )) {
    if (!loquaciousCompleted(game).has(wolf.id)) {
      eliminateWithLovers(game, wolf, deaths);
    }
  }

  if (attackKilled?.role === "猫又") {
    const revengeTargets = alivePlayers(game).filter((player) =>
      isActualWolfRole(player.role),
    );
    if (revengeTargets.length > 0)
      eliminateWithLovers(game, randomItem(revengeTargets), deaths);
  }

  const uniqueDeaths = deaths.filter(
    (player, index) =>
      deaths.findIndex((item) => item.id === player.id) === index,
  );
  recordNightHistory(
    game,
    victimId,
    wasGuarded,
    uniqueDeaths.map((player) => player.id),
  );
  await sendCoronerReports(game, uniqueDeaths);

  const winner = winnerFor(game);
  game.phaseEndsAt = Date.now() + holdSeconds * 1000;
  const morningDescription =
    uniqueDeaths.length > 0
      ? `昨夜、${uniqueDeaths.map((player) => `**${safeName(player)}**`).join("、")} が死亡しました。`
      : !victimId
        ? "人狼の襲撃先がまとまらず、昨夜の犠牲者はいませんでした。"
        : wasGuarded
          ? "護衛が成功し、昨夜の犠牲者はいませんでした。"
          : "昨夜の犠牲者はいませんでした。";
  if (
    !(await updateOrReplacePhasePanel(game, {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${game.day}日目｜朝`)
          .setDescription(morningDescription)
          .setColor(uniqueDeaths.length === 0 ? COLORS.success : COLORS.danger),
      ],
      components: [],
    }))
  )
    return;
  if (!winner) game.day += 1;
  schedule(game, holdSeconds * 1000, () => {
    return winner ? endGame(game, winner) : startDay(game);
  });
}

interface RecapField {
  name: string;
  value: string;
}

function recapPlayer(game: GameState, playerId: string): Player | undefined {
  return game.players.find((player) => player.id === playerId);
}

function recapPlayerName(game: GameState, playerId: string): string {
  const player = recapPlayer(game, playerId);
  return player ? safeName(player) : "不明";
}

function recapFields(name: string, lines: string[]): RecapField[] {
  const values = lines.length > 0 ? lines : ["なし"];
  const chunks: string[] = [];
  let current = "";
  for (const line of values) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > 900 && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((value, index) => ({
    name: index === 0 ? name : `${name}（続き）`,
    value,
  }));
}

function packRecapEmbeds(
  title: string,
  description: string,
  fields: RecapField[],
  color: number,
): EmbedBuilder[] {
  const pages: RecapField[][] = [];
  let page: RecapField[] = [];
  let characters = title.length + description.length;
  for (const field of fields) {
    const fieldCharacters = field.name.length + field.value.length;
    if (
      page.length > 0 &&
      (page.length >= 20 || characters + fieldCharacters > 5_000)
    ) {
      pages.push(page);
      page = [];
      characters = title.length;
    }
    page.push(field);
    characters += fieldCharacters;
  }
  if (page.length > 0) pages.push(page);
  if (pages.length === 0) pages.push([{ name: "記録", value: "なし" }]);
  return pages.map((pageFields, index) =>
    new EmbedBuilder()
      .setTitle(index === 0 ? title : `${title}｜続き`)
      .setDescription(index === 0 ? description : null)
      .addFields(pageFields)
      .setColor(color),
  );
}

function claimRecapLines(game: GameState, day: number): string[] {
  return game.claimHistory
    .filter((event) => event.day === day)
    .map((event) => {
      const speaker = recapPlayer(game, event.speakerId);
      const speakerName = speaker ? safeName(speaker) : "不明";
      if (event.action === "retract")
        return `↩️ **${speakerName}**｜${event.claimedRole}COを取り消し`;
      const actualRole = speaker?.role ?? "不明";
      if (event.claimedRole === "騎士")
        return `🛡️ **${speakerName}**｜騎士CO（実際：${actualRole}）`;
      const target = event.targetId
        ? recapPlayer(game, event.targetId)
        : undefined;
      const targetName = target ? safeName(target) : "不明";
      const actualResult = publicResultForRole(target?.role);
      const resultDay = event.resultDay ?? event.day;
      const result = event.result ?? "不明";
      return `${event.claimedRole === "占い師" ? "🔮" : "👻"} **${speakerName}**｜${event.claimedRole}CO（実際：${actualRole}）｜${resultDay}日目 **${targetName}** は ${result}（実際：${actualResult}）`;
    });
}

function voteRecapLines(game: GameState, day: number): string[] {
  return game.voteHistory
    .filter((record) => record.day === day)
    .sort((left, right) => left.round - right.round)
    .flatMap((record) =>
      record.ballots.map(
        (ballot) =>
          `${record.round === 1 ? "投票" : "再投票"}｜**${recapPlayerName(game, ballot.voterId)}**${recapPlayer(game, ballot.voterId)?.role === "市長" ? "（2票）" : ""} → **${recapPlayerName(game, ballot.targetId)}**`,
      ),
    );
}

function voteResultRecapLine(game: GameState, day: number): string {
  const finalVote = game.voteHistory
    .filter((record) => record.day === day)
    .sort((left, right) => right.round - left.round)[0];
  if (!finalVote) return "投票記録なし";
  const outcome = resolveVoteOutcome(
    finalVote.ballots.flatMap((ballot) =>
      recapPlayer(game, ballot.voterId)?.role === "市長"
        ? [ballot.targetId, ballot.targetId]
        : [ballot.targetId],
    ),
    finalVote.round,
  );
  if (outcome.kind !== "execute") return "処刑なし";
  const executed = recapPlayer(game, outcome.targetId);
  return executed
    ? `**${safeName(executed)}** を処刑（実際：${executed.role}）`
    : "処刑対象は不明";
}

function nightRecapLines(game: GameState, day: number): string[] {
  const night = game.nightHistory.find((record) => record.day === day);
  if (!night) return [];
  const lines: string[] = [];
  for (const choice of night.wolfChoices)
    lines.push(
      `🐺 **${recapPlayerName(game, choice.actorId)}** → **${recapPlayerName(game, choice.targetId)}**`,
    );
  for (const choice of night.guardChoices)
    lines.push(
      `🛡️ **${recapPlayerName(game, choice.actorId)}** → **${recapPlayerName(game, choice.targetId)}**`,
    );
  for (const choice of night.seerChoices) {
    const target = recapPlayer(game, choice.targetId);
    lines.push(
      `🔮 **${recapPlayerName(game, choice.actorId)}** → **${recapPlayerName(game, choice.targetId)}** は ${publicResultForRole(target?.role)}`,
    );
  }
  const specialLabels: Record<string, string> = {
    flee: "🏃 逃亡",
    assassinate: "🗡️ 暗殺",
    sorcery: "🪄 妖術",
    divide: "✂️ 分断",
    compass: "🧭 方位磁針",
    cupid: "💘 恋人選択",
    devotee: "💝 想い人",
    thief: "🥷 怪盗",
  };
  for (const choice of night.specialChoices ?? []) {
    lines.push(
      `${specialLabels[choice.action] ?? choice.action}｜**${recapPlayerName(game, choice.actorId)}** → ${choice.targetIds.map((targetId) => `**${recapPlayerName(game, targetId)}**`).join("・")}`,
    );
  }
  for (const deathId of night.deathIds ?? []) {
    const dead = recapPlayer(game, deathId);
    if (dead) lines.push(`死亡｜**${safeName(dead)}**（${dead.role}）`);
  }
  if (!night.attackTargetId) lines.push("結果｜襲撃先がまとまらず、犠牲者なし");
  else if (night.guarded)
    lines.push(
      `結果｜**${recapPlayerName(game, night.attackTargetId)}** への護衛成功`,
    );
  else if (night.victimId)
    lines.push(`結果｜**${recapPlayerName(game, night.victimId)}** が死亡`);
  return lines;
}

function trueSeerRecapLines(game: GameState): string[] {
  return game.players.flatMap((seer) =>
    (game.seerResults.get(seer.id) ?? []).flatMap((result, index) => {
      const target = recapPlayer(game, result.targetId);
      return target
        ? [
            `🔮 **${safeName(seer)}**｜${index + 1}日目 **${safeName(target)}** は ${result.isWolf ? "人狼" : "人間"}`,
          ]
        : [];
    }),
  );
}

export function postgameRecapEmbeds(game: GameState): EmbedBuilder[] {
  const roleLines = game.players.map(
    (player) =>
      `${player.isNpc ? "🤖" : "👤"} **${safeName(player)}**｜${ROLE_INFO[player.role as RoleName].icon} ${player.role}｜${player.alive ? "生存" : "死亡"}`,
  );
  const embeds = packRecapEmbeds(
    "感想戦｜役職の真相",
    "試合終了後の情報です。評価ではなく、実際に起きたことだけを表示します。",
    [
      ...recapFields("配役", roleLines),
      ...recapFields("本当の占い結果", trueSeerRecapLines(game)),
    ],
    COLORS.lobby,
  );
  const maxDay = Math.max(
    game.day,
    ...game.claimHistory.map((event) => event.day),
    ...game.voteHistory.map((record) => record.day),
    ...game.nightHistory.map((record) => record.day),
  );
  for (let day = 1; day <= maxDay; day += 1) {
    const nightLines = nightRecapLines(game, day);
    embeds.push(
      ...packRecapEmbeds(
        `${day}日目｜振り返り`,
        "公開された発言と、試合終了後に判明した真相を並べています。",
        [
          ...recapFields("CO・判定", claimRecapLines(game, day)),
          ...recapFields("投票先", voteRecapLines(game, day)),
          { name: "投票結果", value: voteResultRecapLine(game, day) },
          ...recapFields(
            "夜の行動",
            nightLines.length > 0 ? nightLines : ["最終日のため夜なし"],
          ),
        ],
        COLORS.day,
      ),
    );
  }
  return embeds;
}

function embedCharacterCount(embed: EmbedBuilder): number {
  const json = embed.toJSON();
  return (
    (json.title?.length ?? 0) +
    (json.description?.length ?? 0) +
    (json.footer?.text.length ?? 0) +
    (json.author?.name.length ?? 0) +
    (json.fields ?? []).reduce(
      (sum, field) => sum + field.name.length + field.value.length,
      0,
    )
  );
}

export function postgameRecapBatches(embeds: EmbedBuilder[]): EmbedBuilder[][] {
  const batches: EmbedBuilder[][] = [];
  let batch: EmbedBuilder[] = [];
  let characters = 0;
  for (const embed of embeds) {
    const embedCharacters = embedCharacterCount(embed);
    if (
      batch.length > 0 &&
      (batch.length >= 10 || characters + embedCharacters > 5_500)
    ) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(embed);
    characters += embedCharacters;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

export function gameResultRow(
  game: GameState,
  includeFeedback = true,
): ActionRowBuilder<ButtonBuilder> {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(resultComponentId("rematch", game))
      .setLabel("もう一度遊ぶ")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(resultComponentId("recap", game))
      .setLabel("試合を振り返る")
      .setEmoji("📖")
      .setStyle(ButtonStyle.Secondary),
  ];
  if (includeFeedback) buttons.push(feedbackIssueButton(game));
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

function didPlayerWin(
  game: GameState,
  player: Player,
  winner: Winner,
  visited = new Set<string>(),
): boolean {
  const isLover = loverPairs(game).some((pair) => pair.includes(player.id));
  if (isLover) return winner === "lovers";
  if (player.role === "キューピッド") return winner === "lovers";
  if (player.role === "妖狐") return winner === "fox";
  if (player.role === "てるてる") return winner === "teruteru";
  if (player.role === "純愛者" && !visited.has(player.id)) {
    visited.add(player.id);
    const targetId = devoteeTargets(game).get(player.id);
    const target = game.players.find((candidate) => candidate.id === targetId);
    return Boolean(
      target?.alive && didPlayerWin(game, target, winner, visited),
    );
  }
  return Boolean(player.role && ROLE_INFO[player.role].team === winner);
}

function winnerPresentation(winner: Winner): {
  name: string;
  line: string;
  color: number;
} {
  if (winner === "villager")
    return {
      name: "村人陣営",
      line: "村からすべての人狼を追放しました。",
      color: COLORS.lobby,
    };
  if (winner === "wolf")
    return {
      name: "人狼陣営",
      line: "人狼は最後まで正体を隠し通しました。",
      color: COLORS.danger,
    };
  if (winner === "fox")
    return {
      name: "妖狐陣営",
      line: "争いを生き抜いた妖狐が、勝利をさらいました。",
      color: COLORS.vote,
    };
  if (winner === "lovers")
    return {
      name: "恋人陣営",
      line: "最後まで生き残った恋人たちが、2人だけの勝利をつかみました。",
      color: 0xeb459e,
    };
  return {
    name: "てるてる",
    line: "処刑されたてるてるが、狙いどおり単独勝利しました。",
    color: COLORS.day,
  };
}

async function endGame(game: GameState, winner: Winner): Promise<void> {
  if (!isActiveGame(game)) return;
  clearGameTimers(game);
  await restoreDivisionChannels(game, "ゲーム終了による分断解除").catch(
    (error) => console.error("Division cleanup during game end failed:", error),
  );
  game.phase = "ended";
  if (!game.analyticsCompleted) {
    game.analyticsCompleted = true;
    const analytics = {
      ...analyticsSnapshot(game),
      winner,
      dayCount: game.day,
      durationSeconds: playedSeconds(game) ?? 0,
      startedAt: game.analyticsStartedAt
        ? new Date(game.analyticsStartedAt).toISOString()
        : undefined,
    };
    queueAnalytics(game, () => recordGameCompleted(analytics));
  }
  const presentation = winnerPresentation(winner);
  const survivors = game.players.filter((player) => player.alive);
  const eliminated = game.players.filter((player) => !player.alive);

  const showFeedback = !game.analyticsFeedbackPromptShown;
  const row = gameResultRow(game, showFeedback);

  const endEmbed = new EmbedBuilder()
    .setTitle(`ゲーム終了｜${presentation.name}の勝利`)
    .setDescription(presentation.line)
    .addFields(
      {
        name: `生存（${survivors.length}人）`,
        value: roleRows(survivors),
      },
      {
        name: `死亡（${eliminated.length}人）`,
        value: roleRows(eliminated),
      },
    )
    .setColor(presentation.color)
    .setFooter({ text: `${game.day}日目で決着` });
  if (usesUnrankedRoleConfig(game))
    endEmbed.addFields({
      name: "戦績",
      value: "カスタム配役のため、記録対象外です。",
    });

  const endPayload = {
    content: "",
    embeds: [endEmbed],
    components: [row, rankingSettingsRow()],
  };
  if (!(await openPhasePanel(game, endPayload))) return;
  if (showFeedback) {
    game.analyticsFeedbackPromptShown = true;
    game.analyticsFeedbackMessageId = game.phaseMessage?.id;
    game.analyticsFeedbackSessionId = analyticsSnapshot(game).sessionId;
  }

  const humanPlayers = game.players
    .filter(
      (player): player is Player & { role: RoleName } =>
        !player.isNpc && player.role !== undefined,
    )
    .map((player) => ({
      userId: player.id,
      displayName: player.name,
      role: player.role,
      won: didPlayerWin(game, player, winner),
      survived: player.alive,
    }));
  const resultMessage = game.phaseMessage;
  if (
    !usesUnrankedRoleConfig(game) &&
    !game.statsRecorded &&
    humanPlayers.length > 0
  ) {
    game.statsRecorded = true;
    const matchId = game.statsMatchId ?? randomUUID();
    void recordGameStats({
      matchId,
      guildId: game.channel.guildId,
      channelId: game.channelId,
      winner,
      dayCount: game.day,
      players: humanPlayers,
    }).then(async (statsResult) => {
      if (statsResult.status !== "saved" || !resultMessage) return;
      const fields = gameStatsFields(humanPlayers, statsResult.players);
      if (fields.length === 0) return;
      endEmbed.addFields(fields);
      await resultMessage.edit({ embeds: [endEmbed] }).catch(() => undefined);
    });
  }

  schedule(game, 10 * 60 * 1000, () => {
    if (games.get(game.channelId) !== game) return;
    games.delete(game.channelId);
    void game.phaseMessage?.edit({ components: [] }).catch(() => undefined);
    if (
      game.analyticsFeedbackMessageId &&
      game.analyticsFeedbackMessageId !== game.phaseMessage?.id
    ) {
      void game.channel.messages
        .fetch(game.analyticsFeedbackMessageId)
        .then((message) => message.edit({ components: [] }))
        .catch(() => undefined);
    }
  });
}

export function gameFeedbackRow(
  game: GameState,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    feedbackIssueButton(game),
  );
}

function feedbackIssueButton(game: GameState): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(feedbackComponentId("feedback-issue", game))
    .setLabel("気になる点を送る")
    .setEmoji("💬")
    .setStyle(ButtonStyle.Secondary);
}

type DetailedFeedbackRating = Exclude<FeedbackRating, "again">;

export function feedbackReasonRows(
  game: GameState,
  rating: DetailedFeedbackRating,
): ActionRowBuilder<ButtonBuilder>[] {
  const reasons = Object.entries(FEEDBACK_REASON_INFO) as Array<
    [FeedbackReason, { label: string; emoji: string }]
  >;
  const buttons = reasons.map(([reason, info]) =>
    new ButtonBuilder()
      .setCustomId(
        feedbackComponentId(`feedback-reason-${rating}-${reason}`, game),
      )
      .setLabel(info.label)
      .setEmoji(info.emoji)
      .setStyle(ButtonStyle.Secondary),
  );
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(0, 5)),
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(5)),
  ];
}

function feedbackParticipant(game: GameState, userId: string): boolean {
  if (game.analyticsFeedbackEligibleUserIds)
    return game.analyticsFeedbackEligibleUserIds.has(userId);
  return game.players.some((player) => player.id === userId && !player.isNpc);
}

function feedbackSavedMessage(
  result: Awaited<ReturnType<typeof recordMatchFeedback>>,
): string {
  if (result.status === "saved") return "感想ありがとう！ 次の改善に使います。";
  if (result.status === "locked")
    return "この連戦では回答済みです。ありがとう！";
  return "感想を保存できませんでした。少し待ってから、もう一度お試しください。";
}

async function submitFeedback(
  game: GameState,
  userId: string,
  rating: FeedbackRating,
  reason?: FeedbackReason,
  comment?: string,
): Promise<string> {
  game.analyticsFeedbackSubmittedUserIds ??= new Set();
  game.analyticsFeedbackSubmittingUserIds ??= new Set();
  if (game.analyticsFeedbackSubmittedUserIds.has(userId))
    return "この連戦では回答済みです。ありがとう！";
  if (game.analyticsFeedbackSubmittingUserIds.has(userId))
    return "感想を送信中です。少し待ってください。";

  game.analyticsFeedbackSubmittingUserIds.add(userId);
  try {
    const result = await recordMatchFeedback({
      sessionId:
        game.analyticsFeedbackSessionId ?? analyticsSnapshot(game).sessionId,
      userId,
      rating,
      reason,
      comment,
    });
    if (result.status === "saved" || result.status === "locked")
      game.analyticsFeedbackSubmittedUserIds.add(userId);
    return feedbackSavedMessage(result);
  } finally {
    game.analyticsFeedbackSubmittingUserIds.delete(userId);
  }
}

async function handleFeedbackButton(
  interaction: ButtonInteraction,
  game: GameState,
  rating: FeedbackRating,
): Promise<void> {
  if (!feedbackParticipant(game, interaction.user.id)) {
    await interaction.reply({
      content: "この試合に参加したプレイヤーだけが回答できます。",
      ephemeral: true,
    });
    return;
  }

  if (game.analyticsFeedbackSubmittedUserIds?.has(interaction.user.id)) {
    await interaction.reply({
      content: "この連戦では回答済みです。ありがとう！",
      ephemeral: true,
    });
    return;
  }

  if (rating !== "again") {
    await interaction.reply({
      content: "いちばん近い理由を1つ選んでください。",
      components: feedbackReasonRows(game, rating),
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const content = await submitFeedback(game, interaction.user.id, rating);
  await interaction.editReply({ content });
}

async function handleFeedbackReason(
  interaction: ButtonInteraction,
  game: GameState,
  rating: DetailedFeedbackRating,
  reason: FeedbackReason,
): Promise<void> {
  if (!feedbackParticipant(game, interaction.user.id)) {
    await interaction.reply({
      content: "この試合に参加したプレイヤーだけが回答できます。",
      ephemeral: true,
    });
    return;
  }

  if (game.analyticsFeedbackSubmittedUserIds?.has(interaction.user.id)) {
    await interaction.update({
      content: "この連戦では回答済みです。ありがとう！",
      components: [],
    });
    return;
  }

  if (reason === "other") {
    const comment = new TextInputBuilder()
      .setCustomId("feedback-comment")
      .setLabel("補足（書かなくてもOK）")
      .setPlaceholder("分かりにくかった所や、直してほしい所など")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000);
    const modal = new ModalBuilder()
      .setCustomId(feedbackComponentId(`feedback-other-${rating}`, game))
      .setTitle("感想を送る")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(comment),
      );
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferUpdate();
  const content = await submitFeedback(
    game,
    interaction.user.id,
    rating,
    reason,
  );
  await interaction.editReply({ content, components: [] });
}

async function handleFeedbackModal(
  interaction: ModalSubmitInteraction,
  game: GameState,
  rating: DetailedFeedbackRating,
): Promise<void> {
  if (!feedbackParticipant(game, interaction.user.id)) {
    await interaction.reply({
      content: "この試合の感想受付は終了しました。",
      ephemeral: true,
    });
    return;
  }

  const comment = interaction.fields
    .getTextInputValue("feedback-comment")
    .trim();
  await interaction.deferReply({ ephemeral: true });
  const content = await submitFeedback(
    game,
    interaction.user.id,
    rating,
    "other",
    comment,
  );
  await interaction.editReply({ content });
}

async function handlePostgameRecap(
  interaction: ButtonInteraction,
  game: GameState,
): Promise<void> {
  if (game.phase !== "ended") {
    await interaction.reply({
      content: "試合終了後に振り返りを表示できます。",
      ephemeral: true,
    });
    return;
  }
  if (game.postgameRecapState === "shown") {
    await interaction.reply({
      content: "この試合の振り返りはすでに表示されています。",
      ephemeral: true,
    });
    return;
  }
  if (game.postgameRecapState === "showing") {
    await interaction.reply({
      content: "振り返りを表示しています。",
      ephemeral: true,
    });
    return;
  }

  game.postgameRecapState = "showing";
  try {
    const batches = postgameRecapBatches(postgameRecapEmbeds(game));
    const [firstBatch, ...remainingBatches] = batches;
    await interaction.reply({ embeds: firstBatch });
    game.postgameRecapState = "shown";
    for (const embeds of remainingBatches) await game.channel.send({ embeds });
  } catch (error) {
    if (game.postgameRecapState !== "shown") game.postgameRecapState = "idle";
    throw error;
  }
}

export function prepareRematchGame(
  game: GameState,
  previousSessionId: string,
  nextSessionId = randomUUID(),
): GameState {
  return {
    ...game,
    phase: "lobby",
    players: game.players
      .filter((player) => !player.isNpc)
      .map((player) => ({ ...player, alive: true, role: undefined })),
    day: 0,
    lastExecuted: undefined,
    executionHistory: [],
    nightHistory: [],
    wolfChatCounts: new Map(),
    loverPairs: [],
    devoteeTargets: new Map(),
    usedRolePowers: new Set(),
    fatalWoundIds: new Set(),
    pendingDivision: undefined,
    divisionGroups: new Map(),
    divisionChannels: undefined,
    divisionPhaseMessages: undefined,
    divisionOriginalViewPermissions: undefined,
    loquaciousMissions: new Map(),
    loquaciousCompleted: new Set(),
    votes: new Map(),
    nightChoices: new Map(),
    npcSuspicion: new Map(),
    npcMemory: new Map(),
    npcClaims: [],
    claimHistory: [],
    npcSeerClaimPlans: new Map(),
    roleDeclarations: new Set(),
    voteHistory: [],
    humanSuspicions: new Map(),
    npcQuestionCounts: new Map(),
    seerResults: new Map(),
    openingDeathIds: [],
    roleDmSent: new Set(),
    roleDmFailures: new Set(),
    pendingDmMessages: new Map(),
    statsMatchId: undefined,
    statsRecorded: false,
    analyticsSourceSessionId: previousSessionId,
    analyticsSessionId: nextSessionId,
    analyticsChainId: game.analyticsChainId ?? previousSessionId,
    analyticsStartedAt: undefined,
    analyticsCompleted: false,
    postgameRecapState: "idle",
    starting: false,
    voteRound: 1,
    voteCandidateIds: [],
    phaseMessage: undefined,
    phaseStartedAt: undefined,
    phaseEndsAt: undefined,
    timers: [],
    resolving: false,
    resolutionQueued: false,
  };
}

async function handleRematch(
  interaction: ButtonInteraction,
  game: GameState,
): Promise<void> {
  if (interaction.user.id !== game.hostId) {
    await interaction.reply({
      content: "再戦を始められるのは主催者だけです。",
      ephemeral: true,
    });
    return;
  }
  if (game.phase !== "ended") {
    await interaction.reply({
      content: "現在は再戦できません。",
      ephemeral: true,
    });
    return;
  }

  const preserveFeedbackRow =
    interaction.message.id === game.analyticsFeedbackMessageId;
  const previousSessionId = analyticsSnapshot(game).sessionId;
  const nextSessionId = randomUUID();
  const rematchGame = prepareRematchGame(
    game,
    previousSessionId,
    nextSessionId,
  );

  await interaction.deferUpdate();
  const lobbyMessage = await game.channel.send(lobbyPayload(rematchGame));
  if (!isActiveGame(game) || game.phase !== "ended") {
    await lobbyMessage
      .edit({
        content: "この募集は終了しました。",
        embeds: [],
        components: [],
      })
      .catch(() => undefined);
    return;
  }

  clearGameTimers(game);
  Object.assign(game, rematchGame, { lobbyMessage });
  queueAnalytics(game, () => recordRematchRequested(previousSessionId));
  const analytics = analyticsSnapshot(game);
  queueAnalytics(game, () => recordLobbyOpened(analytics));
  await interaction
    .editReply({
      components: preserveFeedbackRow ? [gameFeedbackRow(game)] : [],
    })
    .catch((error) => {
      console.error("Previous result controls could not be disabled:", error);
    });
}

export async function handleComponent(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
): Promise<void> {
  const parsed = parseGameComponentId(interaction.customId);
  if (!parsed) return;
  const { action, channelId, sessionId, value: dayText } = parsed;
  const abandonReason = interaction.isButton()
    ? abandonReasonFromAction(action)
    : undefined;
  if (interaction.isButton() && abandonReason) {
    await handleAbandonReasonButton(
      interaction,
      channelId,
      dayText,
      abandonReason,
    );
    return;
  }
  const game = games.get(channelId);

  if (!game) {
    await interaction.reply({
      content:
        "このゲームは終了しているか、Botの再起動で進行情報が失われました。もう一度 `/jinro` から開始してください。",
      ephemeral: true,
    });
    return;
  }

  const resultActions = new Set(["rematch", "recap"]);
  const isChainFeedback = action.startsWith("feedback-");
  const usesSeparateScope = resultActions.has(action) || isChainFeedback;
  if (!usesSeparateScope && !hasCurrentGameSession(game, sessionId)) {
    await interaction.reply({
      content:
        "この試合の操作受付は終了しました。現在の試合画面を使用してください。",
      ephemeral: true,
    });
    return;
  }

  if (interaction.isModalSubmit()) {
    if (action === "wolf-chat-submit") {
      await handleWolfChatSubmit(interaction, game, Number(dayText));
      return;
    }
    const feedbackModal = /^feedback-other-(neutral|issue)$/.exec(action);
    if (feedbackModal) {
      if (dayText !== game.analyticsChainId) {
        await interaction.reply({
          content: "この連戦の感想受付は終了しました。",
          ephemeral: true,
        });
        return;
      }
      await handleFeedbackModal(
        interaction,
        game,
        feedbackModal[1] as DetailedFeedbackRating,
      );
    }
    return;
  }

  if (interaction.isButton()) {
    if (resultActions.has(action) && dayText !== game.analyticsSessionId) {
      await interaction.reply({
        content: "この試合の操作受付は終了しました。",
        ephemeral: true,
      });
      return;
    }
    if (action.startsWith("feedback-") && dayText !== game.analyticsChainId) {
      await interaction.reply({
        content: "この連戦の感想受付は終了しました。",
        ephemeral: true,
      });
      return;
    }
    if (action === "join") await handleJoin(interaction, game, "join");
    else if (action === "leave") await handleJoin(interaction, game, "leave");
    else if (action === "role-config")
      await handleRoleConfigButton(interaction, game);
    else if (action.startsWith("role-"))
      await handleRoleConfigAdjust(interaction, game, action);
    else if (action === "claim")
      await handleClaimButton(interaction, game, Number(dayText));
    else if (action === "claim-quick-seer")
      await handleQuickResultClaim(
        interaction,
        game,
        Number(dayText),
        "占い師",
      );
    else if (action === "claim-quick-medium")
      await handleQuickResultClaim(
        interaction,
        game,
        Number(dayText),
        "霊能者",
      );
    else if (action === "claim-quick-guard")
      await handleQuickGuardClaim(interaction, game, Number(dayText));
    else if (action === "claim-custom-open")
      await handleCustomClaimOpen(interaction, game, Number(dayText));
    else if (action === "claim-retract")
      await handleClaimRetractionPrompt(interaction, game, Number(dayText));
    else if (action === "claim-retract-confirm")
      await handleClaimRetractionConfirm(interaction, game, Number(dayText));
    else if (action === "claim-retract-cancel")
      await handleClaimRetractionCancel(interaction);
    else if (action === "claim-list")
      await handleClaimListButton(interaction, game, Number(dayText));
    else if (action === "suspect-open")
      await handleSuspectOpen(interaction, game, Number(dayText));
    else if (action === "npc-question-open")
      await handleNpcQuestionOpen(interaction, game, Number(dayText));
    else if (action === "vote-open")
      await handleVoteOpen(interaction, game, Number(dayText));
    else if (action === "wolf-chat-open")
      await handleWolfChatOpen(interaction, game, Number(dayText));
    else if (action === "start") await handleStart(interaction, game);
    else if (action === "cancel") await handleCancel(interaction, game);
    else if (action === "recap") await handlePostgameRecap(interaction, game);
    else if (action === "rematch") await handleRematch(interaction, game);
    else if (action === "feedback-again")
      await handleFeedbackButton(interaction, game, "again");
    else if (action === "feedback-neutral")
      await handleFeedbackButton(interaction, game, "neutral");
    else if (action === "feedback-issue")
      await handleFeedbackButton(interaction, game, "issue");
    else {
      const feedbackReason =
        /^feedback-reason-(neutral|issue)-(npc|tempo|controls|roles|bug|other)$/.exec(
          action,
        );
      if (feedbackReason)
        await handleFeedbackReason(
          interaction,
          game,
          feedbackReason[1] as DetailedFeedbackRating,
          feedbackReason[2] as FeedbackReason,
        );
    }
    return;
  }

  const day = Number(dayText);
  if (action === "player-count")
    await handlePlayerCountChange(interaction, game);
  else if (action === "role-config-select")
    await handleRoleConfigSelect(interaction, game);
  else if (action === "claim-role")
    await handleClaimRole(interaction, game, day);
  else if (action.startsWith("claim-target-"))
    await handleClaimTarget(interaction, game, day, action);
  else if (action.startsWith("claim-result-"))
    await handleClaimResult(interaction, game, day, action);
  else if (action === "suspect") await handleSuspect(interaction, game, day);
  else if (action === "suspect-reason")
    await handleSuspectReason(interaction, game, day);
  else if (action === "npc-question")
    await handleNpcQuestion(interaction, game, day);
  else if (action === "vote") await handleVote(interaction, game, day);
  else if (action === "night-kill")
    await handleNightAction(interaction, game, "kill", day);
  else if (action === "night-seer")
    await handleNightAction(interaction, game, "seer", day);
  else if (action === "night-guard")
    await handleNightAction(interaction, game, "guard", day);
  else if (action === "night-flee")
    await handleNightAction(interaction, game, "flee", day);
  else if (action === "night-assassinate")
    await handleNightAction(interaction, game, "assassinate", day);
  else if (action === "night-sorcery")
    await handleNightAction(interaction, game, "sorcery", day);
  else if (action === "night-divide")
    await handleNightAction(interaction, game, "divide", day);
  else if (action === "night-compass")
    await handleNightAction(interaction, game, "compass", day);
  else if (action === "night-cupid")
    await handleNightAction(interaction, game, "cupid", day);
  else if (action === "night-devotee")
    await handleNightAction(interaction, game, "devotee", day);
  else if (action === "night-thief")
    await handleNightAction(interaction, game, "thief", day);
}
