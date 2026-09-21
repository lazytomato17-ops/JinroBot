import {
  buildPlaytestScenarios,
  runScenario,
  type ScenarioSummary,
} from "./playtest-engine";

const TRIALS_PER_SCENARIO = Number(
  process.env.TOMATOBOT_PLAYTEST_TRIALS ?? 500,
);
if (!Number.isInteger(TRIALS_PER_SCENARIO) || TRIALS_PER_SCENARIO <= 0) {
  throw new Error("TOMATOBOT_PLAYTEST_TRIALSは1以上の整数にしてください。");
}

function percent(value: number | null): string {
  return value === null ? "－" : `${(value * 100).toFixed(1)}%`;
}

function weighted(
  summaries: ScenarioSummary[],
  select: (summary: ScenarioSummary) => number,
): number {
  const trials = summaries.reduce((sum, summary) => sum + summary.trials, 0);
  return (
    summaries.reduce(
      (sum, summary) => sum + select(summary) * summary.trials,
      0,
    ) / trials
  );
}

const summaries = buildPlaytestScenarios().map((scenario, index) =>
  runScenario(scenario, TRIALS_PER_SCENARIO, index * 1_000_003),
);

console.log(
  `品質テスト｜${summaries.length}配役 × ${TRIALS_PER_SCENARIO.toLocaleString()}試合`,
);
console.log(
  "配役       村勝率  日数  唯一黒処刑  唯一黒票  偽黒処刑  複数黒票  CO矛盾  発言一致  初日無黒",
);
for (const summary of summaries) {
  console.log(
    [
      summary.scenario.name.padEnd(9),
      percent(summary.villageWinRate).padStart(6),
      summary.averageDays.toFixed(2).padStart(4),
      percent(summary.loneBlackExecutionRate).padStart(9),
      percent(summary.loneBlackVoteRate).padStart(7),
      percent(summary.loneFalseBlackExecutionRate).padStart(7),
      percent(summary.contestedBlackVoteRate).padStart(7),
      percent(summary.ownClaimContradictionRate).padStart(6),
      percent(summary.discussionVoteMatchRate).padStart(7),
      percent(summary.dayOneNoBlackClaimExecutionRate).padStart(7),
    ].join("  "),
  );
}

for (const profile of [
  "ソロ標準",
  "通常配役",
  "狂人入り",
  "複数占い",
  "複数狂人",
  "複数騎士",
  "自由配役",
] as const) {
  const profileSummaries = summaries.filter(
    (summary) => summary.scenario.profile === profile,
  );
  console.log(
    `${profile}｜村勝率 ${percent(weighted(profileSummaries, (summary) => summary.villageWinRate))}｜平均 ${weighted(profileSummaries, (summary) => summary.averageDays).toFixed(2)}日｜人間生存 ${percent(weighted(profileSummaries, (summary) => summary.humanSurvivalRate))}`,
  );
  const roles = ["村人", "人狼", "狂人", "占い師", "騎士", "霊能者"] as const;
  console.log(
    `${profile}・役職生存｜${roles
      .map((role) => {
        const available = profileSummaries.filter((summary) =>
          summary.roleSurvivalRates.has(role),
        );
        return available.length
          ? `${role} ${percent(weighted(available, (summary) => summary.roleSurvivalRates.get(role) ?? 0))}`
          : null;
      })
      .filter(Boolean)
      .join("｜")}`,
  );
}

const frequentTimeouts = summaries.filter(
  (summary) =>
    summary.timeoutRate >
    (summary.scenario.profile === "自由配役" ? 0.05 : 0.01),
);
const inconsistent = summaries.filter(
  (summary) => (summary.ownClaimContradictionRate ?? 0) > 0.01,
);
const extremeBalance = summaries.filter(
  (summary) =>
    summary.scenario.profile !== "自由配役" &&
    // 500試合では0.数ポイントの標本差が出るため、境界値ちょうどを
    // 「極端」と誤判定せず、明確に偏った配役だけを止める。
    (summary.villageWinRate < 0.25 || summary.villageWinRate > 0.76),
);
const weakLoneClaim = summaries.filter(
  (summary) =>
    summary.scenario.profile !== "通常配役" &&
    summary.scenario.profile !== "自由配役" &&
    summary.loneBlackVoteRate !== null &&
    (summary.loneBlackVoteRate <
      (summary.scenario.profile === "複数占い" ? 0.4 : 0.55) ||
      summary.loneBlackVoteRate > 0.95),
);
const extremeContestedClaim = summaries.filter(
  (summary) =>
    summary.scenario.profile !== "自由配役" &&
    summary.contestedBlackVoteRate !== null &&
    (summary.contestedBlackVoteRate < 0.45 ||
      summary.contestedBlackVoteRate >
        (summary.scenario.roles.filter((role) => role === "占い師").length > 1
          ? 0.97
          : 0.8)),
);
const incoherentDiscussion = summaries.filter(
  (summary) =>
    summary.discussionVoteMatchRate !== null &&
    summary.discussionVoteMatchRate < 0.7,
);
if (frequentTimeouts.length) {
  throw new Error(
    `20日以内に終わらない割合が許容値を超えた配役があります: ${frequentTimeouts.map((summary) => summary.scenario.name).join("、")}`,
  );
}
if (inconsistent.length) {
  throw new Error(
    `COと投票の矛盾が1%を超えました: ${inconsistent.map((summary) => summary.scenario.name).join("、")}`,
  );
}
if (extremeBalance.length) {
  throw new Error(
    `勝率が極端な配役があります: ${extremeBalance.map((summary) => summary.scenario.name).join("、")}`,
  );
}
if (weakLoneClaim.length) {
  throw new Error(
    `唯一COへの投票反応が許容範囲を外れました: ${weakLoneClaim.map((summary) => summary.scenario.name).join("、")}`,
  );
}
if (extremeContestedClaim.length) {
  throw new Error(
    `複数CO時の投票反応が許容範囲を外れました: ${extremeContestedClaim.map((summary) => summary.scenario.name).join("、")}`,
  );
}
if (incoherentDiscussion.length) {
  throw new Error(
    `発言と投票の一致率が低すぎます: ${incoherentDiscussion.map((summary) => summary.scenario.name).join("、")}`,
  );
}
