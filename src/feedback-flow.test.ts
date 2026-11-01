import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ButtonInteraction } from "discord.js";
import type { GameState } from "./types";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./analytics", async (original) => ({
  ...(await original<typeof import("./analytics")>()),
  recordMatchFeedback: mocks.save,
}));
import { handleFeedbackReason } from "./game";
import { TEMPO_FEEDBACK_COMMENTS } from "./experience";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ status: "saved", outcome: "created" });
});
function fixture() {
  const game = {
    analyticsSessionId: "session",
    analyticsChainId: "chain",
    analyticsFeedbackSessionId: "session",
    channelId: "channel",
    channel: { guildId: "guild" },
    players: [{ id: "human", isNpc: false, role: "村人", alive: true }],
    roleConfig: { 村人: 1 },
    analyticsFeedbackContextByUserId: new Map([
      ["human", { role: "村人", humans: 1, npcs: 6, profile: "basic" }],
    ]),
  } as unknown as GameState;
  const ui = {
    user: { id: "human" },
    reply: vi.fn(),
    update: vi.fn(),
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
  };
  return { game, ui, interaction: ui as unknown as ButtonInteraction };
}
describe("テンポの感想導線", () => {
  it("詳細を選ぶ前に回答を確定させず、選んだ内容を既存コメント欄へ保存する", async () => {
    const { game, ui, interaction } = fixture();
    await handleFeedbackReason(interaction, game, "issue", "tempo");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(ui.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("どちら") }),
    );
    await handleFeedbackReason(
      interaction,
      game,
      "issue",
      "tempo",
      undefined,
      "fast",
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session",
        rating: "issue",
        reason: "tempo",
        comment: TEMPO_FEEDBACK_COMMENTS.fast,
        experience: { role: "村人", humans: 1, npcs: 6, profile: "basic" },
      }),
    );
    await handleFeedbackReason(
      interaction,
      game,
      "issue",
      "tempo",
      undefined,
      "slow",
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(ui.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: expect.stringContaining("回答済み") }),
    );
  });
  it("未参加者は送れず、保存失敗時は再送を許す", async () => {
    const { game, ui, interaction } = fixture();
    ui.user.id = "outsider";
    await handleFeedbackReason(
      interaction,
      game,
      "issue",
      "tempo",
      undefined,
      "slow",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(ui.reply).toHaveBeenCalled();
    ui.user.id = "human";
    mocks.save.mockResolvedValueOnce({ status: "failed" });
    await handleFeedbackReason(
      interaction,
      game,
      "issue",
      "tempo",
      undefined,
      "unspecified",
    );
    expect(game.analyticsFeedbackSubmittedUserIds?.has("human")).toBe(false);
    await handleFeedbackReason(
      interaction,
      game,
      "issue",
      "tempo",
      undefined,
      "unspecified",
    );
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(game.analyticsFeedbackSubmittedUserIds?.has("human")).toBe(true);
  });
});
