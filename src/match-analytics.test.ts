import { describe, expect, it } from "vitest";
import {
  buildGameplayAnalyticsSummary,
  buildLatestReleaseAnalytics,
} from "./match-analytics";
import type { GameState, Player } from "./types";

function player(id: string, isNpc: boolean): Player {
  return { id, name: id, user: null, isNpc, alive: true };
}

describe("匿名の試合分析", () => {
  it("COと夜能力を対象IDなしの回数へ集約する", () => {
    const summary = buildGameplayAnalyticsSummary({
      players: [player("human-secret", false), player("npc-secret", true)],
      claimHistory: [
        {
          action: "claim",
          day: 1,
          speakerId: "human-secret",
          claimedRole: "占い師",
        },
        {
          action: "claim",
          day: 1,
          speakerId: "npc-secret",
          claimedRole: "騎士",
        },
        {
          action: "retract",
          day: 2,
          speakerId: "human-secret",
          claimedRole: "占い師",
        },
      ],
      nightHistory: [
        {
          day: 1,
          wolfChoices: [
            { actorId: "npc-secret", targetId: "human-secret" },
          ],
          guardChoices: [
            { actorId: "human-secret", targetId: "npc-secret" },
          ],
          seerChoices: [],
          specialChoices: [
            {
              action: "assassinate",
              actorId: "npc-secret",
              targetIds: ["human-secret"],
            },
          ],
          guarded: false,
        },
      ],
      voteHistory: [
        { day: 1, round: 1, ballots: [] },
        { day: 1, round: 2, ballots: [] },
      ],
    } as Pick<
      GameState,
      "players" | "claimHistory" | "nightHistory" | "voteHistory"
    >);

    expect(summary).toEqual({
      schema: 1,
      claims: {
        total: 2,
        human: 1,
        npc: 1,
        retractions: 1,
        byRole: {
          占い師: { total: 1, human: 1, npc: 0 },
          騎士: { total: 1, human: 0, npc: 1 },
        },
      },
      nightActions: {
        kill: { total: 1, human: 0, npc: 1 },
        guard: { total: 1, human: 1, npc: 0 },
        assassinate: { total: 1, human: 0, npc: 1 },
      },
      voteRounds: 2,
    });
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("最新バージョンだけの勝敗と計測件数を集計する", () => {
    const latest = buildLatestReleaseAnalytics([
      {
        app_version: "2.2.0+old",
        started_at: "2026-09-20T00:00:00Z",
        status: "completed",
        winner: "wolf",
      },
      {
        app_version: "2.2.0+new",
        started_at: "2026-09-21T00:00:00Z",
        status: "completed",
        winner: "villager",
        role_config: { 人狼: 1, 占い師: 1 },
        gameplay_summary: {
          schema: 1,
          claims: {
            total: 2,
            human: 1,
            npc: 1,
            retractions: 0,
            byRole: {},
          },
          nightActions: {
            assassinate: { total: 1, human: 0, npc: 1 },
          },
          voteRounds: 1,
        },
      },
      {
        app_version: "2.2.0+new",
        started_at: "2026-09-21T01:00:00Z",
        status: "started",
      },
    ]);

    expect(latest.version).toBe("2.2.0+new");
    expect(latest.started).toBe(2);
    expect(latest.completed).toBe(1);
    expect(latest.wins.villager).toBe(1);
    expect(latest.wins.wolf).toBe(0);
    expect(latest.telemetryMatches).toBe(1);
    expect(latest.claims).toEqual({ total: 2, human: 1, npc: 1 });
    expect(latest.nightActions.assassinate.npc).toBe(1);
    expect(latest.configuredRoles).toEqual({ 人狼: 1, 占い師: 1 });
  });
});
