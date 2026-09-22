import { describe, expect, it } from "vitest";
import {
  adminAnalyticsEmbed,
  analyticsRange,
  buildAdminAnalyticsReport,
  buildGuildFunnelSummary,
  buildPlayerAnalyticsSummary,
  buildRetentionAnalyticsSummary,
  buildSessionAnalyticsSummary,
} from "./admin-analytics";

describe("運営レポート", () => {
  it("JSTの直近7日と前週を分ける", () => {
    expect(analyticsRange(new Date("2026-08-30T03:00:00.000Z"))).toEqual({
      previousStart: "2026-08-17",
      previousEnd: "2026-08-23",
      currentStart: "2026-08-24",
      currentEnd: "2026-08-30",
      currentEndExclusive: "2026-08-31",
    });
  });

  it("日次データを加重平均してDiscord表示へ変換する", () => {
    const report = buildAdminAnalyticsReport(
      [
        {
          day_jst: "2026-08-23",
          started: 4,
          completed: 2,
          started_chains: 2,
          average_matches_per_chain: 1.5,
          first_to_second_match_rate_percent: 50,
        },
        {
          day_jst: "2026-08-24",
          started: "5",
          completed: "4",
          abandoned: 1,
          started_chains: 2,
          solo_starts: 3,
          multiplayer_starts: 2,
          average_matches_per_chain: 2,
          first_to_second_match_rate_percent: 50,
          average_completed_seconds: 240,
          abandoned_voting: 1,
          feedback_again: 2,
          feedback_issue: 1,
          reason_npc: 1,
        },
        {
          day_jst: "2026-08-30",
          started: 3,
          completed: 2,
          started_chains: 1,
          solo_starts: 1,
          multiplayer_starts: 2,
          average_matches_per_chain: 1,
          first_to_second_match_rate_percent: 0,
          average_completed_seconds: 300,
          feedback_neutral: 1,
        },
      ],
      [
        {
          day_jst: "2026-08-24",
          abandoned: 1,
          answered: 1,
          controls: 1,
        },
      ],
      [
        {
          app_version: "2.2.0+abcdef123456",
          started_at: "2026-08-24T00:00:00Z",
        },
        {
          app_version: "2.2.0+abcdef123456",
          started_at: "2026-08-25T00:00:00Z",
        },
        { app_version: "2.1.0", started_at: "2026-08-24T00:00:00Z" },
      ],
      {
        active: 3,
        newPlayers: 1,
        returning: 2,
        previousActive: 3,
      },
      {
        activeGuilds: 2,
        previousActiveGuilds: 2,
        onePlayerStarts: 4,
        twoPlayerStarts: 3,
        threePlusPlayerStarts: 1,
        unfinished: 1,
      },
      new Date("2026-08-30T03:00:00.000Z"),
      {
        enabled: true,
        extended: true,
        current: {
          installs: 2,
          onboardingSent: 2,
          quickStarts: 1,
          lobbies: 1,
          started: 1,
          completed: 1,
          removed: 1,
        },
        previous: {
          installs: 1,
          onboardingSent: 1,
          quickStarts: 0,
          lobbies: 1,
          started: 1,
          completed: 0,
          removed: 0,
        },
      },
      {
        day1Eligible: 2,
        day1Returned: 1,
        day7Eligible: 1,
        day7Returned: 1,
      },
    );

    expect(report.current.started).toBe(8);
    expect(report.current.completed).toBe(6);
    expect(report.current.completionRate).toBe(75);
    expect(report.current.averageMatchesPerChain).toBeCloseTo(5 / 3);
    expect(report.current.secondMatchRate).toBeCloseTo(100 / 3);
    expect(report.current.averageCompletedSeconds).toBe(260);
    expect(report.previous.started).toBe(4);
    expect(report.abandonReasons.controls).toBe(1);
    expect(report.versions[0]).toEqual({
      version: "2.2.0+abcdef123456",
      starts: 2,
    });

    const json = adminAnalyticsEmbed(report).toJSON();
    const content = JSON.stringify(json);
    expect(content).toContain("開始 **8**｜完走 **6**（75.0%）");
    expect(content).toContain("利用者 **3人**｜新規 **1**｜再訪 **2**");
    expect(content).toContain("稼働サーバー **2**｜友達戦率 **50.0%**");
    expect(content).toContain("1人 **4**｜2人 **3**｜3人以上 **1**");
    expect(content).toContain("翌日再訪 **1/2（50.0%）**");
    expect(content).toContain("7日後再訪 **1/1（100.0%）**");
    expect(content).toContain("新規導入 **2**｜案内成功 **2**");
    expect(content).toContain("案内クリック **1**（導入比 50.0%）");
    expect(content).toContain("募集作成 **1**（導入比 50.0%）");
    expect(content).toContain("初戦開始 **1**（導入比 50.0%）");
    expect(content).toContain("初完走 **1**（開始後 100.0%）");
    expect(content).toContain("中断 **1**｜未終了 **1**");
    expect(content).toContain("開始前 **0**｜試合中 **1**｜不明 **0**");
    expect(content).toContain("利用者 3→3（±0）");
    expect(content).toContain("稼働サーバー 2→2（±0）");
    expect(content).toContain("投票 1");
    expect(content).toContain("NPC 1");
    expect(content).toContain("2.2.0（abcdef1）｜2試合");
    expect(content).not.toContain("1010400040797360218");
  });

  it("データがない期間もゼロとして表示する", () => {
    const report = buildAdminAnalyticsReport(
      [],
      [],
      [],
      { active: 0, newPlayers: 0, returning: 0, previousActive: 0 },
      {
        activeGuilds: 0,
        previousActiveGuilds: 0,
        onePlayerStarts: 0,
        twoPlayerStarts: 0,
        threePlusPlayerStarts: 0,
        unfinished: 0,
      },
      new Date("2026-08-30T03:00:00.000Z"),
    );
    const content = JSON.stringify(adminAnalyticsEmbed(report).toJSON());
    expect(report.current.started).toBe(0);
    expect(content).toContain("完走 **0**（—）");
    expect(content).toContain("報告なし");
    expect(content).toContain("前週の試合データなし");
    expect(content).toContain("導入分析用のSQLが未適用");
  });

  it("最新版だけの勝敗と匿名CO・能力集計を表示する", () => {
    const version = "2.2.0+79721cfdc914";
    const report = buildAdminAnalyticsReport(
      [],
      [],
      [
        {
          id: "latest",
          app_version: version,
          started_at: "2026-08-30T01:00:00Z",
          status: "completed",
          winner: "villager",
          role_config: { 人狼: 1, 暗殺者: 1 },
          gameplay_summary: {
            schema: 1,
            claims: {
              total: 3,
              human: 1,
              npc: 2,
              retractions: 1,
              byRole: {},
            },
            nightActions: {
              assassinate: { total: 1, human: 0, npc: 1 },
            },
            voteRounds: 1,
          },
        },
      ],
      undefined,
      undefined,
      new Date("2026-08-30T03:00:00.000Z"),
      undefined,
      undefined,
      version,
    );

    const content = JSON.stringify(adminAnalyticsEmbed(report).toJSON());
    expect(content).toContain("最新版の実戦");
    expect(content).toContain("村 **1**｜狼 **0**");
    expect(content).toContain("CO **3**（人 1・NPC 2）｜撤回 **1**");
    expect(content).toContain("暗殺 1（NPC 1）");
    expect(content).toContain("30完走未満");
  });

  it("導入後の案内・募集・初戦と退出を期間別に集計する", () => {
    const range = analyticsRange(new Date("2026-08-30T03:00:00.000Z"));
    const summary = buildGuildFunnelSummary(
      [
        {
          guild_hash: "current-started",
          installed_at: "2026-08-24T01:00:00Z",
          onboarding_sent_at: "2026-08-24T01:00:02Z",
          quick_start_clicked_at: "2026-08-24T01:00:30Z",
          first_lobby_at: "2026-08-24T01:01:00Z",
          first_started_at: "2026-08-24T01:02:00Z",
          first_completed_at: "2026-08-24T01:05:00Z",
        },
        {
          guild_hash: "current-lobby",
          installed_at: "2026-08-25T01:00:00Z",
          onboarding_sent_at: "2026-08-25T01:00:02Z",
          quick_start_clicked_at: "2026-08-24T23:59:00Z",
          first_lobby_at: "2026-08-25T01:01:00Z",
          first_completed_at: "2026-08-24T23:58:00Z",
          removed_at: "2026-08-26T01:00:00Z",
        },
        {
          guild_hash: "previous",
          installed_at: "2026-08-23T01:00:00Z",
          first_started_at: "2026-08-23T01:02:00Z",
        },
        {
          guild_hash: "preexisting-removed",
          installed_at: null,
          removed_at: "2026-08-27T01:00:00Z",
        },
      ],
      range,
    );

    expect(summary).toEqual({
      enabled: true,
      extended: true,
      current: {
        installs: 2,
        onboardingSent: 2,
        quickStarts: 1,
        lobbies: 2,
        started: 1,
        completed: 1,
        removed: 2,
      },
      previous: {
        installs: 1,
        onboardingSent: 0,
        quickStarts: 0,
        lobbies: 0,
        started: 1,
        completed: 0,
        removed: 0,
      },
    });
  });

  it("匿名参加者を期間ごとに重複なく数える", () => {
    const range = analyticsRange(new Date("2026-08-30T03:00:00.000Z"));
    const players = buildPlayerAnalyticsSummary(
      [
        { id: "previous", started_at: "2026-08-23T03:00:00Z" },
        { id: "current-a", started_at: "2026-08-24T03:00:00Z" },
        { id: "current-b", started_at: "2026-08-30T03:00:00Z" },
      ],
      [
        { session_id: "previous", participant_hash: "same-player" },
        { session_id: "previous", participant_hash: "previous-only" },
        { session_id: "current-a", participant_hash: "same-player" },
        { session_id: "current-a", participant_hash: "new-player" },
        { session_id: "current-b", participant_hash: "new-player" },
      ],
      [{ cohort_day_jst: "2026-08-24", new_players: 1 }],
      range,
    );

    expect(players).toEqual({
      active: 2,
      newPlayers: 1,
      returning: 1,
      previousActive: 2,
    });
  });

  it("今週に再訪日を迎えて判定可能になったコホートだけを集計する", () => {
    const range = analyticsRange(new Date("2026-08-30T03:00:00.000Z"));
    expect(
      buildRetentionAnalyticsSummary([
        {
          cohort_day_jst: "2026-08-20",
          new_players: 2,
          returned_day_1: 1,
          returned_day_7: 1,
        },
        {
          cohort_day_jst: "2026-08-23",
          new_players: 3,
          returned_day_1: 2,
          returned_day_7: null,
        },
        {
          cohort_day_jst: "2026-08-30",
          new_players: 4,
          returned_day_1: null,
          returned_day_7: null,
        },
      ], range),
    ).toEqual({
      day1Eligible: 3,
      day1Returned: 2,
      day7Eligible: 2,
      day7Returned: 1,
    });
  });

  it("初完走は開始記録があり、その後に完走した場合だけ数える", () => {
    const range = analyticsRange(new Date("2026-08-30T03:00:00.000Z"));
    const summary = buildGuildFunnelSummary(
      [
        {
          guild_hash: "completed-without-start",
          installed_at: "2026-08-24T01:00:00Z",
          first_completed_at: "2026-08-24T01:05:00Z",
        },
        {
          guild_hash: "completed-before-start",
          installed_at: "2026-08-25T01:00:00Z",
          first_started_at: "2026-08-25T01:10:00Z",
          first_completed_at: "2026-08-25T01:05:00Z",
        },
      ],
      range,
    );

    expect(summary.current.started).toBe(1);
    expect(summary.current.completed).toBe(0);
  });

  it("拡張SQLが未適用でも従来の導入ファネルを表示する", () => {
    const now = new Date("2026-08-30T03:00:00.000Z");
    const range = analyticsRange(now);
    const report = buildAdminAnalyticsReport(
      [],
      [],
      [],
      undefined,
      undefined,
      now,
      buildGuildFunnelSummary(
        [
          {
            guild_hash: "legacy",
            installed_at: "2026-08-24T01:00:00Z",
            first_lobby_at: "2026-08-24T01:01:00Z",
            first_started_at: "2026-08-24T01:02:00Z",
          },
        ],
        range,
        true,
        false,
      ),
    );
    const content = JSON.stringify(adminAnalyticsEmbed(report).toJSON());

    expect(content).toContain("募集作成 **1**");
    expect(content).toContain("初戦開始 **1**");
    expect(content).toContain("案内クリック **—**｜初完走 **—**");
    expect(content).not.toContain("導入分析用のSQLが未適用");
  });

  it("稼働サーバーと開始人数を期間内で重複なく数える", () => {
    const range = analyticsRange(new Date("2026-08-30T03:00:00.000Z"));
    const sessions = buildSessionAnalyticsSummary(
      [
        {
          id: "previous",
          opened_at: "2026-08-23T03:00:00Z",
          started_at: "2026-08-23T03:01:00Z",
          guild_id: `g1:${"a".repeat(64)}`,
          human_count: 1,
          status: "completed",
        },
        {
          id: "solo",
          opened_at: "2026-08-24T03:00:00Z",
          started_at: "2026-08-24T03:01:00Z",
          guild_id: `g1:${"a".repeat(64)}`,
          human_count: 1,
          status: "completed",
        },
        {
          id: "duo",
          opened_at: "2026-08-25T03:00:00Z",
          started_at: "2026-08-25T03:01:00Z",
          guild_id: `g1:${"b".repeat(64)}`,
          human_count: "2",
          status: "started",
        },
        {
          id: "group",
          opened_at: "2026-08-26T03:00:00Z",
          started_at: "2026-08-26T03:01:00Z",
          guild_id: `g1:${"b".repeat(64)}`,
          human_count: 4,
          status: "reset",
        },
      ],
      range,
    );

    expect(sessions).toEqual({
      activeGuilds: 2,
      previousActiveGuilds: 1,
      activeGuildCountComplete: true,
      previousGuildCountComplete: true,
      onePlayerStarts: 1,
      twoPlayerStarts: 1,
      threePlusPlayerStarts: 1,
      unfinished: 1,
    });
  });

  it("移行前の旧IDや予約値は稼働サーバー数から除外する", () => {
    const range = analyticsRange(new Date("2026-08-30T03:00:00.000Z"));
    const sessions = buildSessionAnalyticsSummary(
      [
        {
          id: "unknown-location",
          opened_at: "2026-08-24T03:00:00Z",
          started_at: "2026-08-24T03:01:00Z",
          guild_id: "anonymous-unavailable",
          human_count: 1,
          status: "completed",
        },
        {
          id: "legacy-location",
          opened_at: "2026-08-24T04:00:00Z",
          started_at: "2026-08-24T04:01:00Z",
          guild_id: "legacy:g:0190cf7d-2f0d-7cb3-b815-f59fb6adc95a",
          human_count: 1,
          status: "completed",
        },
      ],
      range,
    );

    expect(sessions.activeGuilds).toBe(0);
    expect(sessions.activeGuildCountComplete).toBe(true);
    expect(sessions.onePlayerStarts).toBe(2);

    const report = buildAdminAnalyticsReport(
      [],
      [],
      [],
      undefined,
      sessions,
      new Date("2026-08-30T03:00:00.000Z"),
    );
    const content = JSON.stringify(adminAnalyticsEmbed(report).toJSON());
    expect(content).toContain("稼働サーバー **0**");
  });
});
