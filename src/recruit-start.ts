import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  GuildScheduledEventStatus,
} from "discord.js";
import { createLobby } from "./game";
import { parseRecruitButtonCustomId } from "./scheduled-event";

const MENTIONS_PER_MESSAGE = 40;

function discordEventUrl(guildId: string, eventId: string): string {
  return `https://discord.com/events/${guildId}/${eventId}`;
}

async function notifyInterestedUsers(
  interaction: ButtonInteraction,
  userIds: string[],
): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText || userIds.length === 0)
    return;

  for (let index = 0; index < userIds.length; index += MENTIONS_PER_MESSAGE) {
    const ids = userIds.slice(index, index + MENTIONS_PER_MESSAGE);
    const mentions = ids.map((id) => `<@${id}>`).join(" ");
    await channel.send({
      content: [
        mentions,
        "人狼ゲームの開始時刻です。参加する場合は、上のロビーの **「参加する」** を押してください。",
        "※ Discordイベントの「興味あり」だけでは参加確定になりません。",
      ].join("\n"),
      allowedMentions: { users: ids },
    });
  }
}

export async function handleRecruitStartButton(
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

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "サーバーのテキストチャンネルで実行してください。",
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

  try {
    await interaction.deferReply({ ephemeral: true });

    const event = await interaction.guild.scheduledEvents.fetch(data.eventId);
    if (!event) {
      await interaction.editReply({
        content: "Discordイベントが見つかりませんでした。",
      });
      return;
    }

    if (
      event.status === GuildScheduledEventStatus.Canceled ||
      event.status === GuildScheduledEventStatus.Completed
    ) {
      await interaction.editReply({
        content: "このDiscordイベントはすでに終了しています。",
      });
      return;
    }

    const scheduledStartTimestamp = event.scheduledStartTimestamp;
    if (!scheduledStartTimestamp) {
      await interaction.editReply({
        content: "イベントの開始時刻を取得できませんでした。",
      });
      return;
    }

    if (Date.now() < scheduledStartTimestamp) {
      const unix = Math.floor(scheduledStartTimestamp / 1000);
      await interaction.editReply({
        content: `ロビーは開始時刻の <t:${unix}:F> から作成できます（<t:${unix}:R>）。`,
      });
      return;
    }

    const subscribers = await event.fetchSubscribers({ limit: 100 });
    const interestedUserIds = [
      ...new Set(
        [...subscribers.values()]
          .map((subscriber) => subscriber.user)
          .filter((user) => !user.bot && user.id !== data.hostId)
          .map((user) => user.id),
      ),
    ];

    // 「興味あり」は通知対象としてのみ使う。実際の参加はロビーの
    // 「参加する」を押した人だけにする。
    await createLobby(interaction, {
      targetPlayerCount: data.targetPlayerCount,
    });

    const reply = await interaction.fetchReply().catch(() => null);
    const lobbyCreated = Boolean(
      reply?.content.startsWith("ロビーを作成しました。") ||
      reply?.embeds.some((embed) => embed.title === "人狼ゲーム｜参加受付"),
    );
    if (!lobbyCreated) return;

    if (interestedUserIds.length > 0) {
      await notifyInterestedUsers(interaction, interestedUserIds).catch((error) => {
        console.error("Recruitment mention notification failed:", error);
      });
    } else {
      await channel
        .send(
          "イベントで「興味あり」を押した人はいませんでした。参加する人はロビーの **「参加する」** を押してください。",
        )
        .catch(() => undefined);
    }

    const eventUrl = event.url || discordEventUrl(interaction.guildId, event.id);
    const completedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Discordイベントを開く")
        .setStyle(ButtonStyle.Link)
        .setURL(eventUrl),
      new ButtonBuilder()
        .setCustomId(interaction.customId)
        .setLabel("ロビー作成済み")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );

    await interaction.message
      .edit({ components: [completedRow] })
      .catch(() => undefined);
  } catch (error) {
    console.error("Scheduled event lobby import failed:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction
        .editReply({
          content:
            "イベントの参加者を確認できませんでした。イベントが削除されていないか、Botの権限を確認してください。",
        })
        .catch(() => undefined);
    } else {
      await interaction
        .reply({
          content:
            "イベントの参加者を確認できませんでした。イベントが削除されていないか、Botの権限を確認してください。",
          ephemeral: true,
        })
        .catch(() => undefined);
    }
  }
}
