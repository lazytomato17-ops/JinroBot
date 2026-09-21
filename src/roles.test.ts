import { describe, expect, it } from "vitest";
import {
  buildCustomRoles,
  buildRoles,
  getWinner,
  LEGACY_ROLE_NAMES,
  ROLE_INFO,
  roleConfigFromRoles,
  seerResultForRole,
  usesUnrestrictedRoleConfig,
} from "./roles";
import type { RoleConfig } from "./types";

describe("buildRoles", () => {
  it("4人村は人狼1・占い師1・村人2になる", () => {
    expect(buildRoles(4).sort()).toEqual(
      ["人狼", "占い師", "村人", "村人"].sort(),
    );
  });

  it("7人以上では人狼が2人になる", () => {
    expect(buildRoles(7).filter((role) => role === "人狼")).toHaveLength(2);
    expect(buildRoles(15).filter((role) => role === "人狼")).toHaveLength(2);
  });

  it("人数外は拒否する", () => {
    expect(() => buildRoles(3)).toThrow();
    expect(() => buildRoles(16)).toThrow();
  });
});

describe("getWinner", () => {
  it("人狼が全滅すると村人勝利になる", () => {
    expect(
      getWinner([
        { role: "人狼", alive: false },
        { role: "村人", alive: true },
      ]),
    ).toBe("villager");
  });

  it("生存人数が同数になると人狼勝利になる", () => {
    expect(
      getWinner([
        { role: "人狼", alive: true },
        { role: "占い師", alive: true },
      ]),
    ).toBe("wolf");
  });

  it("狂人を勝利判定では人間として数える", () => {
    expect(
      getWinner([
        { role: "人狼", alive: true },
        { role: "狂人", alive: true },
        { role: "村人", alive: true },
      ]),
    ).toBeNull();
    expect(
      getWinner([
        { role: "人狼", alive: true },
        { role: "狂人", alive: true },
      ]),
    ).toBe("wolf");
  });

  it("人狼が全滅すれば狂人が生存していても村人勝利になる", () => {
    expect(
      getWinner([
        { role: "人狼", alive: false },
        { role: "狂人", alive: true },
        { role: "村人", alive: true },
      ]),
    ).toBe("villager");
  });

  it("饒舌な人狼を実際の人狼として数える", () => {
    expect(
      getWinner([
        { role: "饒舌な人狼", alive: true },
        { role: "村人", alive: true },
      ]),
    ).toBe("wolf");
  });

  it("通常決着時に生存妖狐、恋人の順で勝利を横取りする", () => {
    const players = [
      { id: "wolf", role: "人狼" as const, alive: false },
      { id: "fox", role: "妖狐" as const, alive: true },
      { id: "a", role: "村人" as const, alive: true },
      { id: "b", role: "狂人" as const, alive: true },
    ];
    expect(getWinner(players)).toBe("fox");
    expect(getWinner(players, { loverPairs: [["a", "b"]] })).toBe(
      "lovers",
    );
  });
});

describe("旧版の実プレイ20役職", () => {
  it("20役職を過不足なく登録している", () => {
    expect(LEGACY_ROLE_NAMES).toHaveLength(20);
    expect(new Set(LEGACY_ROLE_NAMES).size).toBe(20);
    for (const role of LEGACY_ROLE_NAMES) expect(ROLE_INFO[role]).toBeDefined();
    expect(LEGACY_ROLE_NAMES).toContain("てるてる");
    expect(LEGACY_ROLE_NAMES).not.toContain("テルテル" as never);
  });

  it("20役職をそれぞれカスタム配役へ入れられる", () => {
    for (const role of LEGACY_ROLE_NAMES) {
      const counts = { 人狼: 1, [role]: role === "共有者" ? 2 : 1 } as Partial<
        Omit<RoleConfig, "村人">
      > &
        Pick<RoleConfig, "人狼">;
      const roles = buildCustomRoles(7, counts);
      expect(roles.filter((candidate) => candidate === role)).toHaveLength(
        role === "共有者" ? 2 : 1,
      );
    }
  });

  it("狼憑きと饒舌な人狼は人狼判定になる", () => {
    expect(seerResultForRole("狼憑き")).toBe("人狼");
    expect(seerResultForRole("饒舌な人狼")).toBe("人狼");
    expect(seerResultForRole("狂信者")).toBe("人間");
  });
});

describe("buildCustomRoles", () => {
  it("特殊役職を指定し、残りを村人で埋める", () => {
    const roles = buildCustomRoles(6, {
      人狼: 1,
      狂人: 1,
      占い師: 1,
      騎士: 0,
      霊能者: 1,
    });
    expect(roles.filter((role) => role === "村人")).toHaveLength(2);
    expect(roles.filter((role) => role === "狂人")).toHaveLength(1);
    expect(roles).toHaveLength(6);
  });

  it("開始時点で人狼勝利になる構成は拒否する", () => {
    expect(() =>
      buildCustomRoles(6, {
        人狼: 3,
        狂人: 0,
        占い師: 1,
        騎士: 0,
        霊能者: 0,
      }),
    ).toThrow("開始時点で人狼の勝利条件を満たす");
  });

  it("人狼と狂人の合計が村人陣営以上になる構成は拒否する", () => {
    expect(() =>
      buildCustomRoles(6, {
        人狼: 2,
        狂人: 1,
        占い師: 1,
        騎士: 0,
        霊能者: 0,
      }),
    ).toThrow("村人陣営より少なくしてください");
  });

  it("通常ユーザーは狂人と占い師を2人以上にできない", () => {
    expect(() =>
      buildCustomRoles(7, {
        人狼: 1,
        狂人: 2,
        占い師: 1,
        騎士: 0,
        霊能者: 0,
      }),
    ).toThrow("狂人は1人まで");
    expect(() =>
      buildCustomRoles(7, {
        人狼: 1,
        狂人: 0,
        占い師: 2,
        騎士: 0,
        霊能者: 0,
      }),
    ).toThrow("占い師は1人まで");
  });

  it("騎士は2人まで設定できる", () => {
    const roles = buildCustomRoles(6, {
      人狼: 1,
      狂人: 0,
      占い師: 1,
      騎士: 2,
      霊能者: 1,
    });
    expect(roles.filter((role) => role === "騎士")).toHaveLength(2);
  });

  it("騎士は3人以上にできない", () => {
    expect(() =>
      buildCustomRoles(7, {
        人狼: 1,
        狂人: 0,
        占い師: 1,
        騎士: 3,
        霊能者: 1,
      }),
    ).toThrow("騎士は2人まで");
  });

  it("霊能者は引き続き1人まで設定できる", () => {
    expect(() =>
      buildCustomRoles(7, {
        人狼: 1,
        狂人: 0,
        占い師: 1,
        騎士: 2,
        霊能者: 2,
      }),
    ).toThrow("霊能者は1人まで");
  });

  it("7人なら2人狼と狂人1人を設定できる", () => {
    const roles = buildCustomRoles(7, {
      人狼: 2,
      狂人: 1,
      占い師: 1,
      騎士: 1,
      霊能者: 1,
    });
    expect(roles).toHaveLength(7);
    expect(roles.filter((role) => role === "人狼")).toHaveLength(2);
    expect(roles.filter((role) => role === "狂人")).toHaveLength(1);
  });

  it("βテスターは総人数内なら全特殊役職を個別上限なしで設定できる", () => {
    const roles = buildCustomRoles(
      15,
      {
        人狼: 2,
        狂人: 4,
        占い師: 3,
        騎士: 3,
        霊能者: 3,
      },
      { unrestricted: true },
    );
    expect(roles).toHaveLength(15);
    expect(roles.filter((role) => role === "狂人")).toHaveLength(4);
    expect(roles.filter((role) => role === "霊能者")).toHaveLength(3);
  });

  it("βテスターは人狼陣営が村人陣営より多い逆村を設定できる", () => {
    const roles = buildCustomRoles(
      7,
      {
        人狼: 2,
        狂人: 3,
        占い師: 1,
        騎士: 1,
        霊能者: 0,
      },
      { unrestricted: true },
    );
    expect(roles.filter((role) => role === "人狼")).toHaveLength(2);
    expect(roles.filter((role) => role === "狂人")).toHaveLength(3);
  });

  it("β自由配役でも村人陣営0人と開始時点で決着する構成は拒否する", () => {
    expect(() =>
      buildCustomRoles(
        6,
        {
          人狼: 1,
          狂人: 5,
          占い師: 0,
          騎士: 0,
          霊能者: 0,
        },
        { unrestricted: true },
      ),
    ).toThrow("村人陣営は1人以上");
    expect(() =>
      buildCustomRoles(
        6,
        {
          人狼: 3,
          狂人: 0,
          占い師: 1,
          騎士: 1,
          霊能者: 0,
        },
        { unrestricted: true },
      ),
    ).toThrow("開始時点で人狼の勝利条件を満たす");
  });

  it("通常上限超過と逆村だけを戦績対象外の自由配役として判定する", () => {
    expect(
      usesUnrestrictedRoleConfig(
        roleConfigFromRoles([
          "人狼",
          "狂人",
          "狂人",
          "占い師",
          "騎士",
          "村人",
          "村人",
        ]),
      ),
    ).toBe(true);
    expect(
      usesUnrestrictedRoleConfig(
        roleConfigFromRoles([
          "人狼",
          "人狼",
          "人狼",
          "狂人",
          "占い師",
          "村人",
          "村人",
        ]),
      ),
    ).toBe(true);
    expect(
      usesUnrestrictedRoleConfig(
        roleConfigFromRoles([
          "人狼",
          "狂人",
          "占い師",
          "騎士",
          "霊能者",
          "村人",
          "村人",
        ]),
      ),
    ).toBe(false);
  });
});
