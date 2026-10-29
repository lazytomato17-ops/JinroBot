import { describe, expect, it } from "vitest";
import {
  buildExperienceFeedbackLines,
  buildExperienceSessionLines,
  experienceContext,
} from "./experience";
import type { GameState } from "./types";

describe("体験の内訳", () => {
  it("回答者内の分母と、旧形式の未計測を分離する", () => {
    const lines = buildExperienceFeedbackLines([
      {
        rating: "again",
        experience_context: { role: "村人", humans: 1, profile: "basic" },
      },
      {
        rating: "issue",
        reason: "npc",
        npc_detail: "unfair",
        experience_context: { role: "人狼", humans: 2, profile: "special" },
      },
      { rating: "neutral", reason: "npc" },
      { rating: "invalid" },
    ]).join("\n");
    expect(lines).toContain("回答 **3件**");
    expect(lines).toContain("不公平に感じた **1**");
    expect(lines).toContain("詳細未分類 **1**");
    expect(lines).toContain("ソロ：また遊びたい **1/1**");
    expect(lines).toContain("旧形式・状況未計測 **1件**");
    expect(lines).toContain("新規継続率とは別");
  });
  it("区分内の複数試合を数え、重複参加行を連戦と誤認しない", () => {
    const lines = buildExperienceSessionLines(
      [
        { id: "a", human_count: 1, status: "completed" },
        { id: "b", human_count: 1, status: "cancelled" },
        { id: "c", human_count: 2, status: "completed" },
      ],
      [
        { session_id: "a", participant_hash: "u" },
        { session_id: "a", participant_hash: "u" },
        { session_id: "b", participant_hash: "u" },
        { session_id: "c", participant_hash: "v" },
      ],
    ).join("\n");
    expect(lines).toContain(
      "ソロ：開始 **2**・完走 **1**・区分内2戦以上 **1/1人**",
    );
    expect(lines).toContain(
      "2人：開始 **1**・完走 **1**・区分内2戦以上 **0/1人**",
    );
  });
  it("自分の役職・人数のみを取り、複数能力を別分類にする", () => {
    const game = {
      players: [
        { id: "a", isNpc: false, role: "村人" },
        { id: "b", isNpc: true, role: "騎士" },
      ],
      roleConfig: { 村人: 1, 騎士: 2 },
    } as unknown as GameState;
    expect(experienceContext(game, "a")).toEqual({
      role: "村人",
      humans: 1,
      npcs: 1,
      profile: "special",
    });
    expect(experienceContext(game, "missing").role).toBe("unknown");
    expect(buildExperienceFeedbackLines([])).toEqual([
      "この期間の感想回答はまだありません。",
    ]);
  });
});
