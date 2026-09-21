import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import {
  handleRecruitCommand,
  handleRecruitSetupButton,
  isRecruitButton,
  parseRecruitButtonCustomId,
  parseRecruitStartAt,
  recruitButtonCustomId,
  recruitCommand,
} from "./scheduled-event";

describe("scheduled event recruitment custom ids", () => {
  it("round-trips recruitment button data", () => {
    const data = {
      eventId: "123456789012345678",
      hostId: "234567890123456789",
      targetPlayerCount: 8,
    };
    const customId = recruitButtonCustomId(data);
    expect(parseRecruitButtonCustomId(customId)).toEqual(data);
    expect(isRecruitButton(customId)).toBe(true);
  });

  it("rejects malformed or out-of-range ids", () => {
    expect(parseRecruitButtonCustomId("tb-recruit:start:nope:123:8")).toBeUndefined();
    expect(
      parseRecruitButtonCustomId(
        "tb-recruit:start:123456789012345678:234567890123456789:16",
      ),
    ).toBeUndefined();
    expect(isRecruitButton("tb:join:anything")).toBe(false);
  });
});

describe("recruit setup", () => {
  it("keeps the slash command simple with no required options", () => {
    expect(recruitCommand.toJSON().options ?? []).toHaveLength(0);
  });

  it("parses a JST date and time", () => {
    const result = parseRecruitStartAt(
      "9/20",
      "21:00",
      new Date("2026-09-14T08:00:00.000Z"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    }
  });

  it("accepts full-width input and rolls an omitted past year forward", () => {
    const result = parseRecruitStartAt(
      "１／２",
      "２０：３０",
      new Date("2026-09-14T08:00:00.000Z"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toISOString()).toBe("2027-01-02T11:30:00.000Z");
    }
  });

  it("rejects impossible dates", () => {
    const result = parseRecruitStartAt(
      "2026-02-30",
      "21:00",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(result.ok).toBe(false);
  });

  it("allows ordinary members and blocks duplicate create presses", async () => {
    const commandReply = vi.fn().mockResolvedValue(undefined);
    const commandInteraction = {
      user: { id: "234567890123456780" },
      guildId: "123456789012345670",
      guild: {},
      channelId: "345678901234567890",
      channel: { type: ChannelType.GuildText },
      memberPermissions: null,
      appPermissions: null,
      inGuild: () => true,
      reply: commandReply,
    };

    await handleRecruitCommand(commandInteraction as never);

    const setupPayload = commandReply.mock.calls[0]?.[0];
    const actionRow = setupPayload.components.at(-1).toJSON();
    const createButton = actionRow.components.find(
      (component: { custom_id?: string }) =>
        component.custom_id?.endsWith(":create"),
    );
    expect(createButton?.custom_id).toBeTruthy();

    let finishChannelFetch: (value: null) => void = () => undefined;
    const channelFetch = new Promise<null>((resolve) => {
      finishChannelFetch = resolve;
    });
    const guild = {
      channels: { fetch: vi.fn().mockReturnValue(channelFetch) },
      scheduledEvents: { create: vi.fn() },
    };
    const firstInteraction = {
      customId: createButton?.custom_id,
      user: commandInteraction.user,
      guildId: commandInteraction.guildId,
      guild,
      inGuild: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    const secondInteraction = {
      ...firstInteraction,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };

    const firstCreate = handleRecruitSetupButton(firstInteraction as never);
    await vi.waitFor(() =>
      expect(firstInteraction.deferUpdate).toHaveBeenCalledOnce(),
    );
    await handleRecruitSetupButton(secondInteraction as never);

    expect(secondInteraction.reply).toHaveBeenCalledWith({
      content: "募集を作成中です。そのままお待ちください。",
      ephemeral: true,
    });
    expect(secondInteraction.deferUpdate).not.toHaveBeenCalled();
    expect(guild.scheduledEvents.create).not.toHaveBeenCalled();

    const repeatedCommandReply = vi.fn().mockResolvedValue(undefined);
    await handleRecruitCommand({
      ...commandInteraction,
      reply: repeatedCommandReply,
    } as never);
    expect(repeatedCommandReply).toHaveBeenCalledWith({
      content: "すでに募集を作成中です。そのままお待ちください。",
      ephemeral: true,
    });

    finishChannelFetch(null);
    await firstCreate;
  });

  it("describes interested users as notification targets and rate-limits success", async () => {
    const commandReply = vi.fn().mockResolvedValue(undefined);
    const commandInteraction = {
      user: { id: "234567890123456781" },
      guildId: "123456789012345671",
      guild: {},
      channelId: "345678901234567891",
      channel: { type: ChannelType.GuildText },
      memberPermissions: null,
      appPermissions: null,
      inGuild: () => true,
      reply: commandReply,
    };
    await handleRecruitCommand(commandInteraction as never);

    const setupPayload = commandReply.mock.calls[0]?.[0];
    const actionRow = setupPayload.components.at(-1).toJSON();
    const createButton = actionRow.components.find(
      (component: { custom_id?: string }) =>
        component.custom_id?.endsWith(":create"),
    );
    const send = vi.fn().mockResolvedValue(undefined);
    const scheduledEvent = {
      id: "456789012345678901",
      url: "https://discord.com/events/123/456",
    };
    const create = vi.fn().mockResolvedValue(scheduledEvent);
    const buttonInteraction = {
      customId: createButton?.custom_id,
      user: {
        ...commandInteraction.user,
        displayName: "ホスト",
        tag: "host",
      },
      guildId: commandInteraction.guildId,
      guild: {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            type: ChannelType.GuildText,
            name: "人狼",
            send,
          }),
        },
        scheduledEvents: { create },
      },
      inGuild: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await handleRecruitSetupButton(buttonInteraction as never);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "「興味あり」は開始通知の登録です。参加確定ではありません。",
        ),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining(
                "ロビーの **「参加する」** を押すと参加が確定します。",
              ),
            }),
          }),
        ],
      }),
    );

    const repeatedCommandReply = vi.fn().mockResolvedValue(undefined);
    await handleRecruitCommand({
      ...commandInteraction,
      reply: repeatedCommandReply,
    } as never);
    expect(repeatedCommandReply).toHaveBeenCalledWith({
      content: expect.stringMatching(
        /^募集を作成した直後です。連続作成を防ぐため、あと\d+秒待ってください。$/,
      ),
      ephemeral: true,
    });
  });
});
