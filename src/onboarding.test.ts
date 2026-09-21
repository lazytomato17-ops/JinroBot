import {
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type InteractionReplyOptions,
  type TextChannel,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createLobby, handleComponent, resetChannel } from "./game";
import {
  BOT_INVITE_URL,
  findOnboardingChannel,
  GUIDE_SITE_URL,
  guideCommand,
  guideComponents,
  guideText,
  helpCommand,
  helpText,
  inviteCommand,
  inviteComponents,
  inviteText,
  isOnboardingQuickStartButton,
  ONBOARDING_QUICK_START_BUTTON_ID,
  onboardingComponents,
  onboardingText,
} from "./onboarding";

describe("初回ガイド", () => {
  it("helpコマンドで主要コマンドと1人プレイを案内する", () => {
    expect(helpCommand.toJSON()).toMatchObject({
      name: "help",
      description: "コマンドと遊び方を確認します",
    });
    expect(helpText()).toContain("`/jinro`");
    expect(helpText()).toContain("`/recruit`");
    expect(helpText()).toContain("`/guide`");
    expect(helpText()).toContain("`/stats`");
    expect(helpText()).toContain("`/invite`");
    expect(helpText()).toContain("NPC");
  });

  it("30秒で最初の一戦を始められる情報だけを表示する", () => {
    expect(guideCommand.toJSON()).toMatchObject({
      name: "guide",
      description: "人狼の始め方を30秒で確認します",
    });
    expect(guideText()).toContain("`/jinro` で募集を作る");
    expect(guideText()).toContain("1人ならNPCが補充されます");
    expect(guideText()).toContain("DMを許可");

    const row = guideComponents()[0].toJSON();
    expect(row.components).toHaveLength(2);
    expect(row.components[0]).toMatchObject({
      label: "詳しい遊び方",
      url: GUIDE_SITE_URL,
    });
    expect(row.components[1]).toMatchObject({
      label: "Botを追加",
      url: BOT_INVITE_URL,
    });
  });

  it("招待コマンドは追加リンクだけを本人に案内できる", () => {
    expect(inviteCommand.toJSON()).toMatchObject({
      name: "invite",
      description: "TomatoBotを別のサーバーに追加します",
    });
    expect(inviteText()).toContain("遊びたいサーバーに追加");

    const row = inviteComponents()[0].toJSON();
    expect(row.components).toHaveLength(1);
    expect(row.components[0]).toMatchObject({
      label: "Botを追加",
      url: BOT_INVITE_URL,
    });

    const permissions = BigInt(
      new URL(BOT_INVITE_URL).searchParams.get("permissions") ?? "0",
    );
    expect(permissions & PermissionFlagsBits.ManageChannels).toBe(
      PermissionFlagsBits.ManageChannels,
    );
    expect(permissions & PermissionFlagsBits.CreateEvents).toBe(
      PermissionFlagsBits.CreateEvents,
    );
  });

  it("新規サーバーでは1クリック試遊と再確認の方法を案内する", () => {
    expect(onboardingText()).toContain("追加してくれてありがとうございます");
    expect(onboardingText()).toContain("`/guide`");
    expect(onboardingText()).toContain("友達も「参加する」で合流");

    const row = onboardingComponents()[0].toJSON();
    expect(row.components).toHaveLength(2);
    expect(row.components[0]).toMatchObject({
      custom_id: ONBOARDING_QUICK_START_BUTTON_ID,
      label: "1人ですぐ試す",
    });
    expect(row.components[1]).toMatchObject({
      label: "詳しい遊び方",
      url: GUIDE_SITE_URL,
    });
    expect(isOnboardingQuickStartButton(ONBOARDING_QUICK_START_BUTTON_ID)).toBe(
      true,
    );
    expect(isOnboardingQuickStartButton("tomatobot-ranking-join")).toBe(false);
  });

  it("試遊ボタンから通常と同じNPC入りロビーを作る", async () => {
    const replies: InteractionReplyOptions[] = [];
    const channelId = "quick-start-channel";
    const interaction = {
      inGuild: () => true,
      channelId,
      channel: {
        type: ChannelType.GuildText,
        guildId: "quick-start-guild",
      },
      user: {
        id: "quick-start-user",
        displayName: "初めての人",
      },
      reply: async (payload: InteractionReplyOptions) => {
        replies.push(payload);
      },
      fetchReply: async () => ({
        id: "quick-start-message",
        edit: async () => undefined,
      }),
    } as unknown as ButtonInteraction;

    await createLobby(interaction);

    expect(replies).toHaveLength(1);
    const embed = replies[0].embeds?.[0];
    expect(embed && "toJSON" in embed ? embed.toJSON() : embed).toMatchObject({
      title: "人狼ゲーム｜参加受付",
    });
    expect(JSON.stringify(replies[0])).toContain("ゲーム開始");
    expect(await resetChannel(channelId, false)).toMatchObject({
      status: "reset",
    });
  });

  it("募集メッセージを取得できない場合は二重エラーにせず募集を破棄する", async () => {
    const channelId = "failed-quick-start-channel";
    const editedReplies: InteractionReplyOptions[] = [];
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const interaction = {
      inGuild: () => true,
      channelId,
      channel: {
        type: ChannelType.GuildText,
        guildId: "failed-quick-start-guild",
      },
      user: {
        id: "failed-quick-start-user",
        displayName: "初めての人",
      },
      reply: async () => undefined,
      fetchReply: async () => {
        throw new Error("fetch failed");
      },
      editReply: async (payload: InteractionReplyOptions) => {
        editedReplies.push(payload);
      },
    } as unknown as ButtonInteraction;

    await expect(createLobby(interaction)).resolves.toBeUndefined();

    expect(editedReplies).toHaveLength(1);
    expect(editedReplies[0].content).toContain("この募集を終了しました");
    expect(await resetChannel(channelId, false)).toMatchObject({
      status: "not_found",
    });
    errorLog.mockRestore();
  });

  it("進行パネルを送れない場合は試合を終了して操作状態を残さない", async () => {
    vi.useFakeTimers();
    const channelId = "phase-panel-failure-channel";
    const replies: InteractionReplyOptions[] = [];
    const lobbyEdits: InteractionReplyOptions[] = [];
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const user = {
      id: "phase-panel-failure-user",
      displayName: "進行確認者",
      send: async () => undefined,
    };
    const lobbyMessage = {
      id: "phase-panel-failure-lobby",
      edit: async (payload: InteractionReplyOptions) => {
        lobbyEdits.push(payload);
      },
    };
    const channel = {
      type: ChannelType.GuildText,
      guildId: "phase-panel-failure-guild",
      send: async () => {
        throw new Error("missing send permission");
      },
    };
    const createInteraction = {
      inGuild: () => true,
      channelId,
      channel,
      user,
      reply: async (payload: InteractionReplyOptions) => {
        replies.push(payload);
      },
      fetchReply: async () => lobbyMessage,
    } as unknown as ButtonInteraction;

    try {
      await createLobby(createInteraction);
      const componentRows = replies[0].components?.map((row) =>
        "toJSON" in row ? row.toJSON() : row,
      );
      const startId = componentRows
        ?.flatMap((row) => ("components" in row ? row.components : []))
        .find(
          (component) =>
            "custom_id" in component &&
            typeof component.custom_id === "string" &&
            component.custom_id.includes(":start:"),
        );
      expect(
        startId && "custom_id" in startId ? startId.custom_id : undefined,
      ).toBeTypeOf("string");

      const startInteraction = {
        customId:
          startId && "custom_id" in startId ? startId.custom_id : "missing",
        user,
        isButton: () => true,
        isModalSubmit: () => false,
        deferUpdate: async () => undefined,
        reply: async () => undefined,
      } as unknown as ButtonInteraction;
      await handleComponent(startInteraction);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await resetChannel(channelId, false)).toMatchObject({
        status: "not_found",
      });
      expect(
        lobbyEdits.some((payload) =>
          String(payload.content).includes("進行メッセージを送信できなかった"),
        ),
      ).toBe(true);
    } finally {
      errorLog.mockRestore();
      vi.useRealTimers();
      await resetChannel(channelId, false);
    }
  });

  it("案内を送れる先だけから最上部のテキストチャンネルを選ぶ", () => {
    const makeChannel = (rawPosition: number, allowed: boolean) =>
      ({
        type: ChannelType.GuildText,
        rawPosition,
        guild: { members: { me: {} } },
        permissionsFor: () => ({ has: () => allowed }),
      }) as unknown as TextChannel;
    const blocked = makeChannel(0, false);
    const lower = makeChannel(3, true);
    const upper = makeChannel(1, true);
    const guild = {
      systemChannel: blocked,
      channels: {
        cache: new Map([
          ["blocked", blocked],
          ["lower", lower],
          ["upper", upper],
        ]),
      },
    } as unknown as Guild;

    expect(findOnboardingChannel(guild)).toBe(upper);
  });
});
