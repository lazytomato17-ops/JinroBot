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
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { createLobby } from "./game";

const DEFAULT_TARGET_PLAYER_COUNT = 4;
const MAX_PLAYER_COUNT = 15;
const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
const RECRUIT_BUTTON_PREFIX = "tb-recruit:start:";

export const recruitCommand = new SlashCommandBuilder()
  .setName("recruit")
  .setDescription("Discordイベントで人狼の参加者を募集します")
  .addIntegerOption((option) =>
    option
      .setName("minutes")
      .setDescription("開始までの時間（分）")
      .setRequired(true)
      .setMinValue(10)
      .setMaxValue(7 * 24 * 60),
  )
  .addIntegerOption((option) =>
    option
      .setName("players")
      .setDescription("予定プレイ人数（4〜15人、未指定なら4人）")
      .setMinValue(4)
      .setMaxValue(MAX_PLAYER_COUNT),
  )
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("イベント名（未指定なら自動生成）")
      .setMaxLength(80),
  );

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
  )
    return undefined;
  return { eventId, hostId, targetPlayerCount };
}

export function isRecruitButton(customId: string): boolean {
  return parseRecruitButtonCustomId(customId) !== undefined;
}

function discordEventUrl(guildId: string, eventId: string): string {
  return `https://discord.com/events/${guildId}/${eventId}`;
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

  const canCreateEvents = Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.CreateEvents),
  );
  if (!canCreateEvents) {
    await interaction.reply({
      content: "Discordイベントを作成する権限がありません。サーバーで「イベントを作成」権限を付けてもらってください。",
      ephemeral: true,
    });
    return;
  }

  const minutes = interaction.options.getInteger("minutes", true);
  const targetPlayerCount =
    interaction.options.getInteger("players") ?? DEFAULT_TARGET_PLAYER_COUNT;
  const customName = interaction.options.getString("name")?.trim();
  const eventName = customName || `人狼ゲーム｜${targetPlayerCount}人募集`;
  const startAt = new Date(Date.now() + minutes * 60_000);
  const endAt = new Date(startAt.getTime() + EVENT_DURATION_MS);

  await interaction.deferReply();
  try {
    const event = await interaction.guild.scheduledEvents.create({
      name: eventName,
      description: [
        "Tomatobotの人狼募集です。",
        "参加する人はこのイベントの「興味あり」を押してください。",
        `予定人数：${targetPlayerCount}人（最大${MAX_PLAYER_COUNT}人）`,
        `開催チャンネル：<#${interaction.channelId}>`,
        "開始時にホストが募集メッセージのボタンを押すと、興味ありのメンバーをロビーへ取り込みます。",
      ].join("\n"),
      entityType: GuildScheduledEventEntityType.External,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      scheduledStartTime: startAt,
      scheduledEndTime: endAt,
      entityMetadata: { location: `#${interaction.channel.name}` },
      reason: `Tomatobot recruitment created by ${interaction.user.tag}`,
    });

    const eventUrl = event.url || discordEventUrl(interaction.guildId, event.id);
    const embed = new EmbedBuilder()
      .setTitle(eventName)
      .setDescription(
        [
          `開始：<t:${Math.floor(startAt.getTime() / 1000)}:F>（<t:${Math.floor(startAt.getTime() / 1000)}:R>）`,
          `予定人数：**${targetPlayerCount}人**`,
          "",
          "参加する人はDiscordイベントを開いて **「興味あり」** を押してください。",
          "開始時にホストが下のボタンを押すと、参加表明したメンバーで既存の人狼ロビーを作成します。",
        ].join("\n"),
      )
      .setColor(0x5865f2)
      .setFooter({ text: `ホスト：${interaction.user.displayName}` });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Discordイベントを開く")
        .setStyle(ButtonStyle.Link)
        .setURL(eventUrl),
      new ButtonBuilder()
        .setCustomId(
          recruitButtonCustomId({
            eventId: event.id,
            hostId: interaction.user.id,
            targetPlayerCount,
          }),
        )
        .setLabel("ロビーを作成")
        .setStyle(ButtonStyle.Success),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error("Scheduled event creation failed:", error);
    await interaction.editReply({
      content:
        "Discordイベントを作成できませんでした。Botに「イベントを作成 / イベントを管理」権限があるか確認してください。",
      embeds: [],
      components: [],
    });
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
      .filter((user) => !user.bot);
    const uniqueInterestedCount = new Set(
      interestedUsers.map((user) => user.id).filter((id) => id !== data.hostId),
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
