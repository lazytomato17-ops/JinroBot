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
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createLobby } from "./game";

const DEFAULT_TARGET_PLAYER_COUNT = 8;
const MAX_PLAYER_COUNT = 15;
const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
const RECRUIT_BUTTON_PREFIX = "tb-recruit:start:";
const RECRUIT_SETUP_PREFIX = "tb-recruit:setup:";
const RECRUIT_SETUP_TTL_MS = 30 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type RecruitSetupAction =
  | "datetime"
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
  startAt?: Date;
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
    action !== "datetime" &&
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

function setupPanel(session: RecruitSetupSession): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const startText = session.startAt
    ? `<t:${Math.floor(session.startAt.getTime() / 1000)}:F>（<t:${Math.floor(session.startAt.getTime() / 1000)}:R>）`
    : "**未設定**";

  const embed = new EmbedBuilder()
    .setTitle("人狼募集の設定")
    .setDescription(
      [
        `📅 開始日時：${startText}`,
        `👥 募集人数：**${session.targetPlayerCount}人**`,
        `📝 タイトル：**${session.eventName}**`,
        "",
        "必要な項目を変更して、最後に「募集開始」を押してください。",
      ].join("\n"),
    )
    .setColor(0x5865f2)
    .setFooter({
      text: "日時は日本時間（JST）として扱います・設定は30分で期限切れ",
    });

  const settingsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(setupCustomId(session.id, "datetime"))
      .setLabel("日時を設定")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(setupCustomId(session.id, "players"))
      .setLabel("人数を設定")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(setupCustomId(session.id, "name"))
      .setLabel("タイトルを設定")
      .setStyle(ButtonStyle.Secondary),
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(setupCustomId(session.id, "create"))
      .setLabel("募集開始")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!session.startAt),
    new ButtonBuilder()
      .setCustomId(setupCustomId(session.id, "cancel"))
      .setLabel("キャンセル")
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [settingsRow, actionRow] };
}

function dateInputValue(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  const { year, month, day } = jstParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function timeInputValue(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  const { hour, minute } = jstParts(date);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
    createdAt: Date.now(),
  };
  recruitSetupSessions.set(session.id, session);

  await interaction.reply({ ...setupPanel(session), ephemeral: true });
}

export async function handleRecruitSetupButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseSetupCustomId(interaction.customId);
  if (!parsed) return;

  const session = getSetupSession(parsed.sessionId);
  if (
    !session ||
    interaction.user.id !== session.hostId ||
    interaction.guildId !== session.guildId
  ) {
    await interaction.reply({
      content:
        "この募集設定は期限切れです。もう一度 `/recruit` を実行してください。",
      ephemeral: true,
    });
    return;
  }

  if (parsed.action === "datetime") {
    const dateInput = new TextInputBuilder()
      .setCustomId("recruit-date")
      .setLabel("開始日（例: 9/20 または 2026-09-20）")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("9/20");
    const dateValue = dateInputValue(session.startAt);
    if (dateValue) dateInput.setValue(dateValue);

    const timeInput = new TextInputBuilder()
      .setCustomId("recruit-time")
      .setLabel("開始時刻（例: 21:00）")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("21:00");
    const timeValue = timeInputValue(session.startAt);
    if (timeValue) timeInput.setValue(timeValue);

    const modal = new ModalBuilder()
      .setCustomId(setupCustomId(session.id, "datetime"))
      .setTitle("開始日時を設定")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput),
      );

    await interaction.showModal(modal);
    return;
  }

  if (parsed.action === "players") {
    const input = new TextInputBuilder()
      .setCustomId("recruit-players")
      .setLabel(`募集人数（4〜${MAX_PLAYER_COUNT}）`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(String(session.targetPlayerCount));

    const modal = new ModalBuilder()
      .setCustomId(setupCustomId(session.id, "players"))
      .setTitle("募集人数を設定")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

    await interaction.showModal(modal);
    return;
  }

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

  if (!session.startAt) {
    await interaction.reply({
      content: "先に開始日時を設定してください。",
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
  const parsed = parseSetupCustomId(interaction.customId);
  if (!parsed) return;

  const session = getSetupSession(parsed.sessionId);
  if (
    !session ||
    interaction.user.id !== session.hostId ||
    interaction.guildId !== session.guildId
  ) {
    await interaction.reply({
      content:
        "この募集設定は期限切れです。もう一度 `/recruit` を実行してください。",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.isFromMessage()) {
    await interaction.reply({
      content: "設定画面からもう一度操作してください。",
      ephemeral: true,
    });
    return;
  }

  if (parsed.action === "datetime") {
    const result = parseRecruitStartAt(
      interaction.fields.getTextInputValue("recruit-date"),
      interaction.fields.getTextInputValue("recruit-time"),
    );

    if (!result.ok) {
      await interaction.reply({ content: result.error, ephemeral: true });
      return;
    }

    session.startAt = result.value;
    await interaction.update(setupPanel(session));
    return;
  }

  if (parsed.action === "players") {
    const value = Number(
      normaliseInput(interaction.fields.getTextInputValue("recruit-players")),
    );

    if (
      !Number.isInteger(value) ||
      value < 4 ||
      value > MAX_PLAYER_COUNT
    ) {
      await interaction.reply({
        content: `募集人数は4〜${MAX_PLAYER_COUNT}の整数で入力してください。`,
        ephemeral: true,
      });
      return;
    }

    session.targetPlayerCount = value;
    await interaction.update(setupPanel(session));
    return;
  }

  if (parsed.action === "name") {
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
