import { describe, expect, it } from "vitest";
import {
  buildPlaytestScenarios,
  runScenario,
  simulateGame,
} from "./playtest-engine";
import { buildSoloRoles } from "./solo";

describe("自動品質テスト", () => {
  it("4〜15人を標準・通常・複数役職で検証対象にする", () => {
    const scenarios = buildPlaytestScenarios();
    for (let count = 4; count <= 15; count += 1) {
      expect(
        scenarios.some(
          (scenario) =>
            scenario.profile === "ソロ標準" &&
            scenario.roles.length === count &&
            scenario.humanCount === 1,
        ),
      ).toBe(true);
      expect(
        scenarios.some(
          (scenario) =>
            scenario.profile === "通常配役" &&
            scenario.roles.length === count &&
            scenario.humanCount === 2,
        ),
      ).toBe(true);
    }
    expect(
      scenarios.some(
        (scenario) =>
          scenario.profile === "狂人入り" && scenario.roles.length === 4,
      ),
    ).toBe(false);
    for (let count = 5; count <= 15; count += 1) {
      const doubleSeer = scenarios.find(
        (scenario) =>
          scenario.profile === "複数占い" && scenario.roles.length === count,
      );
      expect(doubleSeer).toBeDefined();
      expect(
        doubleSeer?.roles.filter((role) => role === "占い師"),
      ).toHaveLength(2);
      expect(
        doubleSeer?.roles.filter((role) => role === "人狼").length,
      ).toBeGreaterThanOrEqual(2);
    }
    for (let count = 7; count <= 15; count += 1) {
      expect(
        scenarios.some(
          (scenario) =>
            scenario.name === `占い2狂-${count}人` &&
            scenario.roles.filter((role) => role === "占い師").length === 2 &&
            scenario.roles.includes("狂人"),
        ),
      ).toBe(true);
      expect(
        scenarios.some(
          (scenario) =>
            scenario.name === `占い3-${count}人` &&
            scenario.roles.filter((role) => role === "占い師").length === 3 &&
            scenario.roles.filter((role) => role === "人狼").length === 3,
        ),
      ).toBe(true);
      expect(
        scenarios.some(
          (scenario) =>
            scenario.name === `狂人2-${count}人` &&
            scenario.roles.filter((role) => role === "狂人").length === 2,
        ),
      ).toBe(true);
      expect(
        scenarios.some(
          (scenario) =>
            scenario.name === `騎士2-${count}人` &&
            scenario.roles.filter((role) => role === "騎士").length === 2,
        ),
      ).toBe(true);
    }
    for (let count = 11; count <= 15; count += 1) {
      expect(
        scenarios.some(
          (scenario) =>
            scenario.name === `複数最大-${count}人` &&
            scenario.roles.filter((role) => role === "占い師").length === 3 &&
            scenario.roles.filter((role) => role === "狂人").length === 2,
        ),
      ).toBe(true);
    }
    expect(
      scenarios.some(
        (scenario) =>
          scenario.name === "自由逆村7人" &&
          scenario.roles.filter((role) => role === "人狼" || role === "狂人")
            .length >
            scenario.roles.filter((role) => role !== "人狼" && role !== "狂人")
              .length,
      ),
    ).toBe(true);
    expect(
      scenarios.some(
        (scenario) =>
          scenario.name === "自由霊能3-11人" &&
          scenario.roles.filter((role) => role === "霊能者").length === 3,
      ),
    ).toBe(true);
  });

  it("同じシードなら同じ試合結果を再現する", () => {
    const roles = buildSoloRoles(7);
    expect(simulateGame(roles, 123_456)).toEqual(simulateGame(roles, 123_456));
  });

  it("7人の標準試合で唯一COを参考にしつつ矛盾を起こさない", () => {
    const summary = runScenario(
      {
        name: "テスト7人",
        profile: "ソロ標準",
        roles: buildSoloRoles(7),
        humanCount: 1,
      },
      120,
      700_000,
    );
    expect(summary.timeoutRate).toBe(0);
    expect(summary.ownClaimContradictionRate ?? 0).toBeLessThanOrEqual(0.01);
    expect(summary.loneBlackVoteRate ?? 0).toBeGreaterThan(0.6);
    expect(summary.loneBlackVoteRate ?? 1).toBeLessThan(0.95);
    expect(summary.villageWinRate).toBeGreaterThan(0.25);
    expect(summary.villageWinRate).toBeLessThan(0.75);
  });

  it("占い師2人の自由配役でも夜行動と進行が止まらない", () => {
    const summary = runScenario(
      {
        name: "占い師2人",
        profile: "複数占い",
        roles: ["人狼", "人狼", "占い師", "占い師", "騎士", "霊能者", "村人"],
        humanCount: 1,
      },
      80,
      900_000,
    );
    expect(summary.timeoutRate).toBe(0);
    expect(summary.ownClaimContradictionRate ?? 0).toBeLessThanOrEqual(0.01);
    expect(summary.villageWinRate).toBeGreaterThan(0.3);
    expect(summary.villageWinRate).toBeLessThan(0.7);
  });

  it("占い師3人・狂人2人の最大構成でも進行停止を1%以内に抑える", () => {
    const summary = runScenario(
      {
        name: "複数最大11人",
        profile: "複数狂人",
        roles: [
          "人狼",
          "人狼",
          "人狼",
          "狂人",
          "狂人",
          "占い師",
          "占い師",
          "占い師",
          "騎士",
          "霊能者",
          "村人",
        ],
        humanCount: 1,
      },
      100,
      1_100_000,
    );
    expect(summary.timeoutRate).toBeLessThanOrEqual(0.01);
    expect(summary.ownClaimContradictionRate ?? 0).toBeLessThanOrEqual(0.01);
    expect(summary.villageWinRate).toBeGreaterThan(0.25);
    expect(summary.villageWinRate).toBeLessThan(0.75);
  });

  it("騎士2人の自由配役でも夜行動と進行が止まらない", () => {
    const summary = runScenario(
      {
        name: "騎士2人",
        profile: "複数騎士",
        roles: ["人狼", "人狼", "占い師", "騎士", "騎士", "霊能者", "村人"],
        humanCount: 1,
      },
      120,
      1_200_000,
    );
    expect(summary.timeoutRate).toBe(0);
    expect(summary.villageWinRate).toBeGreaterThan(0);
    expect(summary.villageWinRate).toBeLessThan(1);
  });

  it("逆村と全役職複数のβ自由配役でも進行が止まらない", () => {
    const scenarios = buildPlaytestScenarios().filter(
      (scenario) => scenario.profile === "自由配役",
    );
    expect(scenarios).toHaveLength(3);
    for (const [index, scenario] of scenarios.entries()) {
      const summary = runScenario(scenario, 100, 1_300_000 + index * 100_000);
      expect(summary.timeoutRate, scenario.name).toBeLessThanOrEqual(0.05);
      expect(
        summary.ownClaimContradictionRate ?? 0,
        scenario.name,
      ).toBeLessThanOrEqual(0.01);
    }
  });

  it("同じ10人構成では村人を2人目の妖狐に替えると妖狐勝利が増える", () => {
    const oneFox = [
      "人狼",
      "狂人",
      "占い師",
      "騎士",
      "霊能者",
      "妖狐",
      "村人",
      "村人",
      "村人",
      "村人",
    ] as const;
    const twoFox = [
      ...oneFox.slice(0, -1),
      "妖狐",
    ] as (typeof oneFox)[number][];
    const foxWins = (roles: typeof twoFox) =>
      Array.from({ length: 250 }, (_, index) =>
        simulateGame([...roles], 12_345 + index * 97, 2),
      ).filter((result) => result.winner === "fox").length;

    expect(foxWins(twoFox)).toBeGreaterThan(foxWins([...oneFox]));
  });
});
