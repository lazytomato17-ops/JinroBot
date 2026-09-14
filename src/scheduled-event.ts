import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createLobby } from "./game";

const DEFAULT_TARGET_PLAYER_COUNT = 7;
const MAX_PLAYER_COUNT = 15;
const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
const RECRUIT_BUTTON_PREFIX = "tb-recruit:start:";
const RECRUIT_SETUP_PREFIX = "tb-recruit:setup:";
const RECRUIT_SETUP_TTL_MS = 30 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_OPTION_DAYS = 25;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

type RecruitSetupAction =
  | "date"
  | "hour"
  | "minute"
  | "players"
  | "name"
  | "create"
  | "cancel";

interface RecruitSetupSession {
  id: string;
  hostId: string;
  guildId: string;
  channelId: string;
  eventName: string;
  targetPlayerCount: number;
  startAt: Date;
  createdAt: number;
}

const recruitSetupSessions = new Map<string, RecruitSetupSession>();

export const recruitCommand = new SlashCommandBuilder()
  .setName("recruit")
  .setDescription("Discordイベントで人狼の参加者を募集します");

export interface RecruitButtonData {
  eventId: string;
  hostId: string;
  targetPlayerCount: number;
}

export function recruitButtonCustomId(data: RecruitButtonData): string {
  return `${RECRUIT_BUTTON_PREFIX}${data.eventId}:${data.hostId}:${data.targetPlayerCount}`;
}

export function parseRecruitButtonCustomId(
  customId: string,
): RecruitButtonData | undefined {
  if (!customId.startsWith(RECRUIT_BUTTON_PREFIX)) return undefined;

  const [eventId, hostId, playerCountText, ...rest] = customId
    .slice(RECRUIT_BUTTON_PREFIX.length)
    .split(":");

  if (rest.length || !/^\d{17,20}$/.test(eventId ?? "")) return undefined;
  if (!/^\d{17,20}$/.test(hostId ?? "")) return undefined;

  const targetPlayerCount = Number(playerCountText);
  if (
    !Number.isInteger(targetPlayerCount) ||
    targetPlayerCount < 4 ||
    targetPlayerCount > MAX_PLAYER_COUNT
  ) {
    return undefined;
  }

  return { eventId, hostId, targetPlayerCount };
}

export function isRecruitButton(customId: string): boolean {
  return parseRecruitButtonCustomId(customId) !== undefined;
}

function normaliseInput(value: string): string {
  return value
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/／/g, "/")
    .replace(/：/g, ":")
    .replace(/[－―ー]/g, "-")
    .trim();
}

function jstParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function makeJstDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | undefined {
  const result = new Date(
    Date.UTC(year, month - 1, day, hour, minute) - JST_OFFSET_MS,
  );
  const parts = jstParts(result);

  if (
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute
  ) {
    return undefined;
  }

  return result;
}

export type RecruitStartAtParseResult =
  | { ok: true; value: Date }
  | { ok: false; error: string };

export function parseRecruitStartAt(
  dateInput: string,
  timeInput: string,
  now = new Date(),
): RecruitStartAtParseResult {
  const dateText = normaliseInput(dateInput);
  const timeText = normaliseInput(timeInput);
  const dateMatch = /^(?:(\d{4})[\/-])?(\d{1,2})[\/-](\d{1,2})$/.exec(
    dateText,
  );
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeText);

  if (!dateMatch) {
    return {
      ok: false,
      error: "日付は `9/20` または `2026-09-20` の形で入力してください。",
    };
  }
  if (!timeMatch) {
    return {
      ok: false,
      error: "時刻は `21:00` の形で入力してください。",
    };
  }

  const explicitYear = dateMatch[1] ? Number(dateMatch[1]) : undefined;
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { ok: false, error: "日付または時刻が正しくありません。" };
  }

  const currentYear = jstParts(now).year;
  let year = explicitYear ?? currentYear;
  let startAt = makeJstDate(year, month, day, hour, minute);

  if (!startAt) {
    return { ok: false, error: "存在しない日付です。" };
  }

  if (!explicitYear && startAt.getTime() <= now.getTime()) {
    year += 1;
    startAt = makeJstDate(year, month, day, hour, minute);
    if (!startAt) {
      return { ok: false, error: "存在しない日付です。" };
    }
  }

  if (startAt.getTime() <= now.getTime()) {
    return { ok: false, error: "開始日時は現在より後にしてください。" };
  }

  return { ok: true, value: startAt };
}

function setupCustomId(sessionId: string, action: RecruitSetupAction): string {
  return `${RECRUIT_SETUP_PREFIX}${sessionId}:${action}`;
}

function parseSetupCustomId(
  customId: string,
): { sessionId: string; action: RecruitSetupAction } | undefined {
  if (!customId.startsWith(RECRUIT_SETUP_PREFIX)) return undefined;

  const [sessionId, action, ...rest] = customId
    .slice(RECRUIT_SETUP_PREFIX.length)
    .split(":");

  if (rest.length || !/^[a-z0-9]+$/i.test(sessionId ?? "")) return undefined;
  if (
    action !== "date" &&
    action !== "hour" &&
    action !== "minute" &&
    action !== "players" &&
    action !== "name" &&
    action !== "create" &&
    action !== "cancel"
  ) {
    return undefined;
  }

  return { sessionId, action };
}

export function isRecruitSetupComponent(customId: string): boolean {
  return parseSetupCustomId(customId) !== undefined;
}

function newSetupSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function getSetupSession(sessionId: string): RecruitSetupSession | undefined {
  const session = recruitSetupSessions.get(sessionId);
  if (!session) return undefined;

  if (Date.now() - session.createdAt > RECRUIT_SETUP_TTL_MS) {
    recruitSetupSessions.delete(sessionId);
    return undefined;
  }

  return session;
}

function defaultRecruitStartAt(now = new Date()): Date {
  const parts = jstParts(now);
  let candidate = makeJstDate(parts.year, parts.month, parts.day, 21, 0);
  if (candidate && candidate.getTime() > now.getTime() + 2 * 60_000) {
    return candidate;
  }

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowParts = jstParts(tomorrow);
  candidate = makeJstDate(
    tomorrowParts.year,
    tomorrowParts.month,
    tomorrowParts.day,
    21,
    0,
  );
  if (!candidate) throw new Error("Could not build default recruitment time");
  return candidate;
}

function sameJstDate(a: Date, b: Date): boolean {
  const first = jstParts(a);
  const second = jstParts(b);
  return (
    first.year === second.year &&
    first.month === second.month &&
    first.day === second.day
  );
}

function dateOptions(startAt: Date, now = new Date()) {
  const today = jstParts(now);
  return Array.from({ length: DATE_OPTION_DAYS }, (_, offset) => {
    const normalized = new Date(
      Date.UTC(today.year, today.month - 1, today.day + offset),
    );
    const year = normalized.getUTCFullYear();
    const month = normalized.getUTCMonth() + 1;
    const day = normalized.getUTCDate();
    const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const prefix = offset === 0 ? "今日 " : offset === 1 ? "明日 " : "";
    const label = `${prefix}${month}/${day}(${WEEKDAYS[normalized.getUTCDay()]})`;
    const optionDate = makeJstDate(year, month, day, 12, 0);

    return {
      label,
      value,
      default: optionDate ? sameJstDate(optionDate, startAt) : false,
    };
  });
}

function setupPanel(session: RecruitSetupSession) {
  const parts = jstParts(session.startAt);
  const unix = Math.floor(session.startAt.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle("人狼募集の設定")
    .setDescription(
      [
        `📅 開始日時：<t:${unix}:F>（<t:${unix}:R>）`,
        `👥 募集人数：**${session.targetPlayerCount}人**`,
        `📝 タイトル：**${session.eventName}**`,
        "",
        "日付・時刻・人数は下のメニューから選べます。",
        "そのままでよければ「募集開始」を押すだけです。",
      ].join("\n"),
    )
    .setColor(0x5865f2)
    .setFooter({
      text: "日時は日本時間（JST）・初期時刻は次の21:00・設定は30分で期限切れ",
    });

  const dateRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(setupCustomId(session.id, "date"))
      .setPlaceholder("開始日を選ぶ")
      .addOptions(...dateOptions(session.startAt)),
  );

  const hourRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(setupCustomId(session.id, "hour"))
      .setPlaceholder("開始時刻（時）")
      .addOptions(
        ...Array.from({ length: 24 }, (_, hour) => ({
          label: `${String(hour).padStart(2, "0")}時`,
          value: String(hour),
          default: hour === parts.hour,
        })),
      ),
  );

  const minuteRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(setupCustomId(session.id, "minute"))
      .setPlaceholder("開始時刻（分）")
      .addOptions(
        ...Array.from({ length: 12 }, (_, index) => index * 5).map((minute) => ({
          label: `${String(minute).padStart(2, "0")}分`,
          value: String(minute),
          default: minute === parts.minute,
        })),
      ),
  );

  const playersRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(setupCustomId(session.id, "players"))
      .setPlaceholder("募集人数を選ぶ")
      .addOptions(
        ...Array.from({ length: MAX_PLAYER_COUNT - 3 }, (_, index) => index + 4).map(
          (players) => ({
            label: `${players}人`,
            value: String(players),
            default: players === session.targetPlayerCount,
          }),
        ),
      ),
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(setupCustomId(session.id, "name"))
      .setLabel("タイトル変更")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(setupCustomId(session.id, "create"))
      .setLabel("募集開始")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(setupCustomId(session.id, "cancel"))
      .setLabel("キャンセル")
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [dateRow, hourRow, minuteRow, playersRow, actionRow],
  };
}

function discordEventUrl(guildId: string, eventId: string): string {
  return `https://discord.com/events/${guildId}/${eventId}`;
}

function recruitmentMessage(
  eventName: string,
  startAt: Date,
  targetPlayerCount: number,
  hostId: string,
  hostDisplayName: string,
  guildId: string,
  eventId: string,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const eventUrl = discordEventUrl(guildId, eventId);
  const embed = new EmbedBuilder()
    .setTitle(eventName)
    .setDescription(
      [
        `開始：<t:${Math.floor(startAt.getTime() / 1000)}:F>（<t:${Math.floor(startAt.getTime() / 1000)}:R>）`,
        `予定人数：**${targetPlayerCount}人**`,
        "",
        "参加する人はDiscordイベントを開いて **「興味あり」** を押してください。",
        "開始時にホストが下のボタンを押すと、参加表明したメンバーで人狼ロビーを作成します。",
      ].join("\n"),
    )
    .setColor(0x5865f2)
    .setFooter({ text: `ホスト：${hostDisplayName}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Discordイベントを開く")
      .setStyle(ButtonStyle.Link)
      .setURL(eventUrl),
    new ButtonBuilder()
      .setCustomId(
        recruitButtonCustomId({
          eventId,
          hostId,
          targetPlayerCount,
        }),
      )
      .setLabel("ロビーを作成")
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}

function setupSessionForInteraction(
  customId: string,
  userId: string,
  guildId: string | null,
): { parsed: { sessionId: string; action: RecruitSetupAction }; session: RecruitSetupSession } | undefined {
  const parsed = parseSetupCustomId(customId);
  if (!parsed) return undefined;

  const session = getSetupSession(parsed.sessionId);
  if (!session || userId !== session.hostId || guildId !== session.guildId) {
    return undefined;
  }

  return { parsed, session };
}

export async function handleRecruitCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !interaction.inGuild() ||
    !interaction.guild ||
    interaction.channel?.type !== ChannelType.GuildText
  ) {
    await interaction.reply({
      content: "サーバーのテキストチャンネルで実行してください。",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.CreateEvents)) {
    await interaction.reply({
      content:
        "Discordイベントを作成する権限がありません。サーバーで「イベントを作成」権限を付けてもらってください。",
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.appPermissions &&
    (!interaction.appPermissions.has(PermissionFlagsBits.CreateEvents) ||
      !interaction.appPermissions.has(PermissionFlagsBits.SendMessages))
  ) {
    await interaction.reply({
      content:
        "Botに「イベントを作成」と「メッセージを送信」の権限が必要です。",
      ephemeral: true,
    });
    return;
  }

  const session: RecruitSetupSession = {
    id: newSetupSessionId(),
    hostId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    eventName: "人狼ゲーム",
    targetPlayerCount: DEFAULT_TARGET_PLAYER_COUNT,
    startAt: defaultRecruitStartAt(),
    createdAt: Date.now(),
  };
  recruitSetupSessions.set(session.id, session);

  await interaction.reply({ ...setupPanel(session), ephemeral: true });
}

export async function handleRecruitSetupSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const state = setupSessionForInteraction(
    interaction.customId,
    interaction.user.id,
    interaction.guildId,
  );
  if (!state) {
    await interaction.reply({
      content:
        "この募集設定は期限切れです。もう一度 `/recruit` を実行してください。",
      ephemeral: true,
    });
    return;
  }

  const { parsed, session } = state;
  const selected = interaction.values[0];
  if (!selected) return;
  const current = jstParts(session.startAt);
  let nextStartAt: Date | undefined;

  if (parsed.action === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(selected);
    if (!match) return;
    nextStartAt = makeJstDate(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      current.hour,
      current.minute,
    );
  } else if (parsed.action === "hour") {
    const hour = Number(selected);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
    nextStartAt = makeJstDate(
      current.year,
      current.month,
      current.day,
      hour,
      current.minute,
    );
  } else if (parsed.action === "minute") {
    const minute = Number(selected);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return;
    nextStartAt = makeJstDate(
      current.year,
      current.month,
      current.day,
      current.hour,
      minute,
    );
  } else if (parsed.action === "players") {
    const players = Number(selected);
    if (
      !Number.isInteger(players) ||
      players < 4 ||
      players > MAX_PLAYER_COUNT
    ) {
      return;
    }
    session.targetPlayerCount = players;
    await interaction.update(setupPanel(session));
    return;
  } else {
    return;
  }

  if (!nextStartAt || nextStartAt.getTime() <= Date.now()) {
    await interaction.reply({
      content: "その開始日時は過去です。現在より後の日時を選んでください。",
      ephemeral: true,
    });
    return;
  }

  session.startAt = nextStartAt;
  await interaction.update(setupPanel(session));
}

export async function handleRecruitSetupButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const state = setupSessionForInteraction(
    interaction.customId,
    interaction.user.id,
    interaction.guildId,
  );
  if (!state) {
    await interaction.reply({
      content:
        "この募集設定は期限切れです。もう一度 `/recruit` を実行してください。",
      ephemeral: true,
    });
    return;
  }

  const { parsed, session } = state;

  if (parsed.action === "name") {
    const input = new TextInputBuilder()
      .setCustomId("recruit-name")
      .setLabel("イベントタイトル")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80)
      .setValue(session.eventName);

    const modal = new ModalBuilder()
      .setCustomId(setupCustomId(session.id, "name"))
      .setTitle("タイトルを設定")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

    await interaction.showModal(modal);
    return;
  }

  if (parsed.action === "cancel") {
    recruitSetupSessions.delete(session.id);
    await interaction.update({
      content: "募集設定をキャンセルしました。",
      embeds: [],
      components: [],
    });
    return;
  }

  if (parsed.action !== "create") return;

  if (session.startAt.getTime() <= Date.now()) {
    await interaction.reply({
      content: "開始日時が過ぎています。日時を選び直してください。",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "サーバー内で実行してください。",
      ephemeral: true,
    });
    return;
  }

  const channel = await interaction.guild.channels
    .fetch(session.channelId)
    .catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "募集先のテキストチャンネルが見つかりませんでした。",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  let event;
  try {
    event = await interaction.guild.scheduledEvents.create({
      name: session.eventName,
      description: [
        "Tomatobotの人狼募集です。",
        "参加する人はこのイベントの「興味あり」を押してください。",
        `予定人数：${session.targetPlayerCount}人（最大${MAX_PLAYER_COUNT}人）`,
        `開催チャンネル：<#${session.channelId}>`,
        "開始時にホストが募集メッセージのボタンを押すと、興味ありのメンバーをロビーへ取り込みます。",
      ].join("\n"),
      entityType: GuildScheduledEventEntityType.External,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      scheduledStartTime: session.startAt,
      scheduledEndTime: new Date(session.startAt.getTime() + EVENT_DURATION_MS),
      entityMetadata: { location: `#${channel.name}` },
      reason: `Tomatobot recruitment created by ${interaction.user.tag}`,
    });
  } catch (error) {
    console.error("Scheduled event creation failed:", error);
    await interaction.editReply({
      content:
        "Discordイベントを作成できませんでした。Botのイベント権限を確認してください。",
      ...setupPanel(session),
    });
    return;
  }

  try {
    await channel.send(
      recruitmentMessage(
        session.eventName,
        session.startAt,
        session.targetPlayerCount,
        session.hostId,
        interaction.user.displayName,
        interaction.guildId,
        event.id,
      ),
    );
  } catch (error) {
    console.error("Recruitment message send failed:", error);
    await event.delete().catch(() => undefined);
    await interaction.editReply({
      content:
        "募集メッセージを送信できませんでした。Botのメッセージ送信権限を確認してください。",
      ...setupPanel(session),
    });
    return;
  }

  recruitSetupSessions.delete(session.id);
  const eventUrl = event.url || discordEventUrl(interaction.guildId, event.id);
  await interaction.editReply({
    content: `募集を開始しました。\n${eventUrl}`,
    embeds: [],
    components: [],
  });
}

export async function handleRecruitSetupModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const state = setupSessionForInteraction(
    interaction.customId,
    interaction.user.id,
    interaction.guildId,
  );
  if (!state) {
    await interaction.reply({
      content:
        "この募集設定は期限切れです。もう一度 `/recruit` を実行してください。",
      ephemeral: true,
    });
    return;
  }

  const { parsed, session } = state;
  if (parsed.action !== "name") return;

  if (!interaction.isFromMessage()) {
    await interaction.reply({
      content: "設定画面からもう一度操作してください。",
      ephemeral: true,
    });
    return;
  }

  const value = interaction.fields.getTextInputValue("recruit-name").trim();
  if (!value || value.length > 80) {
    await interaction.reply({
      content: "タイトルは1〜80文字で入力してください。",
      ephemeral: true,
    });
    return;
  }

  session.eventName = value;
  await interaction.update(setupPanel(session));
}

export async function handleRecruitButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const data = parseRecruitButtonCustomId(interaction.customId);
  if (!data) return;

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "このボタンはサーバー内でのみ使用できます。",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== data.hostId) {
    await interaction.reply({
      content: "ロビーを作成できるのは募集ホストだけです。",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const event = await interaction.guild.scheduledEvents.fetch(data.eventId);
    if (!event) {
      await interaction.editReply("Discordイベントが見つかりませんでした。");
      return;
    }

    if (
      event.status === GuildScheduledEventStatus.Canceled ||
      event.status === GuildScheduledEventStatus.Completed
    ) {
      await interaction.editReply("このDiscordイベントはすでに終了しています。");
      return;
    }

    const subscribers = await event.fetchSubscribers({ limit: 100 });
    const interestedUsers = [...subscribers.values()]
      .map((subscriber) => subscriber.user)
      .filter((user) => !user.bot && user.id !== data.hostId);

    const uniqueInterestedCount = new Set(
      interestedUsers.map((user) => user.id),
    ).size;

    if (uniqueInterestedCount + 1 > MAX_PLAYER_COUNT) {
      await interaction.editReply(
        `ホストを含めて${uniqueInterestedCount + 1}人が参加予定です。Tomatobotは最大${MAX_PLAYER_COUNT}人なので、「興味あり」を${MAX_PLAYER_COUNT - 1}人以下にしてから開始してください。`,
      );
      return;
    }

    await createLobby(interaction, {
      participants: interestedUsers,
      targetPlayerCount: data.targetPlayerCount,
    });
  } catch (error) {
    console.error("Scheduled event lobby import failed:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction
        .editReply(
          "イベントの参加者を取得できませんでした。イベントが削除されていないか、Botの権限を確認してください。",
        )
        .catch(() => undefined);
    }
  }
}
