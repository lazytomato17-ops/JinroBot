import { ChannelType, GuildScheduledEventStatus } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLobby } from "./game";
import { handleRecruitStartButton } from "./recruit-start";
import { recruitButtonCustomId } from "./scheduled-event";

vi.mock("./game", () => ({
  createLobby: vi.fn(),
}));

const mockedCreateLobby = vi.mocked(createLobby);

describe("scheduled event lobby start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acknowledges the button before requesting data from Discord", async () => {
    const calls: string[] = [];
    const send = vi.fn().mockResolvedValue(undefined);
    const edit = vi.fn().mockResolvedValue(undefined);
    const event = {
      id: "123456789012345678",
      status: GuildScheduledEventStatus.Scheduled,
      scheduledStartTimestamp: Date.now() - 1_000,
      url: "https://discord.com/events/111/123",
      fetchSubscribers: vi.fn().mockImplementation(async () => {
        calls.push("subscribers");
        return new Map([
          ["subscriber", { user: { id: "345678901234567890", bot: false } }],
        ]);
      }),
    };
    const interaction = {
      customId: recruitButtonCustomId({
        eventId: event.id,
        hostId: "234567890123456789",
        targetPlayerCount: 7,
      }),
      user: { id: "234567890123456789" },
      guildId: "123456789012345679",
      guild: {
        scheduledEvents: {
          fetch: vi.fn().mockImplementation(async () => {
            calls.push("event");
            return event;
          }),
        },
      },
      channel: { type: ChannelType.GuildText, send },
      message: { edit },
      deferred: false,
      replied: false,
      inGuild: () => true,
      deferReply: vi.fn().mockImplementation(async () => {
        calls.push("defer");
        interaction.deferred = true;
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
      fetchReply: vi.fn().mockResolvedValue({
        content: "ロビーを作成しました。参加者：1人",
        embeds: [],
      }),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    mockedCreateLobby.mockImplementation(async () => {
      calls.push("lobby");
    });

    await handleRecruitStartButton(interaction as never);

    expect(calls).toEqual(["defer", "event", "subscribers", "lobby"]);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("「参加する」"),
      }),
    );
    expect(edit).toHaveBeenCalledOnce();
  });
});
