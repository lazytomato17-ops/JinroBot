import * as http from "http";
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import * as dotenv from "dotenv";
import { handleAdminAnalyticsCommand } from "./admin-analytics";
import { recordGuildFunnelEvent } from "./analytics";
import { createLobby, handleComponent, resetChannel } from "./game";
import { healthResponse } from "./health";
import {
  guideCommand,
  handleGuideCommand,
  handleHelpCommand,
  handleInviteCommand,
  helpCommand,
  inviteCommand,
  isOnboardingQuickStartButton,
  sendGuildOnboarding,
} from "./onboarding";
import {
  getPublicRankings,
  handleRankingButton,
  handleRankingCommand,
  isRankingButton,
} from "./ranking";
import { showStats } from "./stats";
import {
  handleRecruitButton,
  handleRecruitCommand,
  handleRecruitSetupButton,
  handleRecruitSetupModal,
  handleRecruitSetupSelect,
  isRecruitButton,
  isRecruitSetupComponent,
  recruitCommand,
} from "./scheduled-event";

dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

const commands = [
  new SlashCommandBuilder()
    .setName("jinro")
    .setDescription("シンプルな人狼ゲームを開始します"),
  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("自分が開始した人狼ゲームを終了します"),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("自分の戦績を確認します"),
  helpCommand,
  guideCommand,
  inviteCommand,
  recruitCommand,
  new SlashCommandBuilder()
    .setName("analytics")
    .setDescription("運営者専用のプレイ状況を表示します"),
  new SlashCommandBuilder()
    .setName("ranking")
    .setDescription("公開ランキングへの参加設定を変更します")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("join")
        .setDescription("公開ランキングに参加します"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("leave")
        .setDescription("公開ランキングから退出します"),
    ),
].map((command) => command.toJSON());

client.once(Events.ClientReady, async (readyClient) => {
  readyClient.user.setActivity("/jinro で人狼", {
    type: ActivityType.Playing,
  });
  await readyClient.application.commands.set(commands).catch((error) => {
    console.error("Discord command sync failed:", error);
  });
  console.log(`${readyClient.user.tag} is ready.`);
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

client.on(Events.GuildCreate, async (guild) => {
  const [, sent] = await Promise.all([
    recordGuildFunnelEvent(guild.id, "installed"),
    sendGuildOnboarding(guild).catch((error) => {
      console.error("Guild onboarding failed:", error);
      return false;
    }),
  ]);
  if (sent) await recordGuildFunnelEvent(guild.id, "onboarding_sent");
});

client.on(Events.GuildDelete, async (guild) => {
  await recordGuildFunnelEvent(guild.id, "removed");
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "jinro") {
        await createLobby(interaction);
      } else if (interaction.commandName === "reset") {
        await interaction.deferReply({ ephemeral: true });
        const result = await resetChannel(interaction.channelId, true, {
          userId: interaction.user.id,
          canManageMessages: Boolean(
            interaction.memberPermissions?.has(
              PermissionFlagsBits.ManageMessages,
            ),
          ),
          collectReason: true,
        });
        await interaction.editReply({
          content:
            result.status === "reset"
              ? result.components.length
                ? "ゲームを終了しました。\nよければ、終了した理由を1つ教えてください（任意）。"
                : "ゲームを終了しました。"
              : result.status === "forbidden"
                ? "ゲームを終了できるのはホストまたは管理者だけです。"
                : "進行中のゲームはありません。",
          components: result.components,
        });
      } else if (interaction.commandName === "stats") {
        await showStats(interaction);
      } else if (interaction.commandName === "guide") {
        await handleGuideCommand(interaction);
      } else if (interaction.commandName === "help") {
        await handleHelpCommand(interaction);
      } else if (interaction.commandName === "invite") {
        await handleInviteCommand(interaction);
      } else if (interaction.commandName === "recruit") {
        await handleRecruitCommand(interaction);
      } else if (interaction.commandName === "analytics") {
        await handleAdminAnalyticsCommand(interaction);
      } else if (interaction.commandName === "ranking") {
        await handleRankingCommand(interaction);
      }
      return;
    }

    if (
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit()
    ) {
      if (
        interaction.isButton() &&
        isOnboardingQuickStartButton(interaction.customId)
      ) {
        if (interaction.guildId) {
          void recordGuildFunnelEvent(
            interaction.guildId,
            "quick_start_clicked",
          );
        }
        await createLobby(interaction);
        return;
      }
      if (interaction.isButton() && isRankingButton(interaction.customId)) {
        await handleRankingButton(interaction);
        return;
      }
      if (
        interaction.isStringSelectMenu() &&
        isRecruitSetupComponent(interaction.customId)
      ) {
        await handleRecruitSetupSelect(interaction);
        return;
      }
      if (
        interaction.isButton() &&
        isRecruitSetupComponent(interaction.customId)
      ) {
        await handleRecruitSetupButton(interaction);
        return;
      }
      if (
        interaction.isModalSubmit() &&
        isRecruitSetupComponent(interaction.customId)
      ) {
        await handleRecruitSetupModal(interaction);
        return;
      }
      if (interaction.isButton() && isRecruitButton(interaction.customId)) {
        await handleRecruitButton(interaction);
        return;
      }
      await handleComponent(interaction);
    }
  } catch (error) {
    console.error("Interaction error:", error);
    const message = {
      content: "処理中にエラーが発生しました。",
      ephemeral: true,
    } as const;
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred)
        await interaction.followUp(message).catch(() => undefined);
      else await interaction.reply(message).catch(() => undefined);
    }
  }
});

const port = Number(process.env.PORT ?? 10000);
const server = http.createServer(async (request, response) => {
  const path = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  ).pathname;

  if (path === "/api/rankings") {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    const result = await getPublicRankings();
    response.writeHead(result.status === "found" ? 200 : 503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify(
        result.status === "found"
          ? result.payload
          : { error: "rankings_unavailable" },
      ),
    );
    return;
  }

  const health = healthResponse(client.isReady());
  response.writeHead(health.statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(health.body);
});
server.listen(port);

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required.");
void client.login(token).catch((error) => {
  console.error("Discord login failed:", error);
  process.exitCode = 1;
  server.close();
});
