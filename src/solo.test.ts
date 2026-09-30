import { describe, expect, it } from "vitest";
import { getWinner } from "./roles";
import {
  assignGameRoles,
  buildSoloRoles,
  chooseNpcRevoteTarget,
  chooseNpcVoteTarget,
  SOLO_PLAYER_COUNT,
} from "./solo";
import type { Player, RoleName } from "./types";

function soloPlayers(): Player[] {
  return [
    { id: "human", name: "Human", user: null, isNpc: false, alive: true },
    ...Array.from({ length: SOLO_PLAYER_COUNT - 1 }, (_, index) => ({
      id: `npc-${index}`,
      name: `NPC${index}`,
      user: null,
      isNpc: true,
      alive: true,
    })),
  ];
}

describe("1人プレイの編成", () => {
  it("人間にも配役に含まれる全役職を割り当てられる", () => {
    const configuredRoles: RoleName[] = [
      "人狼",
      "狂人",
      "村人",
      "霊能者",
      "占い師",
      "騎士",
      "村人",
    ];

    for (const expectedRole of [
      "人狼",
      "狂人",
      "村人",
      "霊能者",
      "占い師",
      "騎士",
    ] as const) {
      const roleIndex = configuredRoles.indexOf(expectedRole);
      const rolesWithExpectedFirst = [
        configuredRoles[roleIndex],
        ...configuredRoles.slice(0, roleIndex),
        ...configuredRoles.slice(roleIndex + 1),
      ];
      const assignments = assignGameRoles(
        soloPlayers(),
        () => 0.999999,
        rolesWithExpectedFirst,
      );
      expect(assignments.get("human")).toBe(expectedRole);
      expect([...assignments.values()].sort()).toEqual(
        [...configuredRoles].sort(),
      );
    }
  });

  it("4〜15人のどの人数でも役職数が一致する", () => {
    for (let count = 4; count <= 15; count += 1) {
      expect(buildSoloRoles(count)).toHaveLength(count);
      expect(
        buildSoloRoles(count).filter((role) => role === "人狼"),
      ).toHaveLength(1);
    }
  });

  it("カスタム配役でも人間とNPCを区別せず抽選する", () => {
    const assignments = assignGameRoles(soloPlayers(), () => 0.999999, [
      "人狼",
      "人狼",
      "占い師",
      "騎士",
      "村人",
      "村人",
      "村人",
    ]);
    expect(assignments.get("human")).toBe("人狼");
    expect(
      [...assignments.values()].filter((role) => role === "人狼"),
    ).toHaveLength(2);
  });

  it("村側が処刑・襲撃で2人減っても即終了しない", () => {
    const players = soloPlayers();
    const assignments = assignGameRoles(players, () => 0.25);
    players.forEach((player) => {
      player.role = assignments.get(player.id);
    });
    players
      .filter((player) => player.role !== "人狼")
      .slice(0, 2)
      .forEach((player) => {
        player.alive = false;
      });
    expect(getWinner(players)).toBeNull();
  });
});

describe("NPC投票", () => {
  it("占いで黒判定された対象を優先する", () => {
    const target = chooseNpcVoteTarget(
      { id: "npc-a", role: "村人" },
      [
        { id: "npc-a", role: "村人" },
        { id: "wolf", role: "人狼" },
        { id: "other", role: "村人" },
      ],
      new Map([
        ["wolf", 5],
        ["other", 0],
      ]),
      () => 0,
    );
    expect(target).toBe("wolf");
  });

  it("自分自身には投票しない", () => {
    const target = chooseNpcVoteTarget(
      { id: "npc-a", role: "村人" },
      [
        { id: "npc-a", role: "村人" },
        { id: "npc-b", role: "村人" },
      ],
      new Map([["npc-a", 100]]),
      () => 0,
    );
    expect(target).toBe("npc-b");
  });

  it("共有者NPCは初回・再投票とも既知の相方を避ける", () => {
    const actor = { id: "shared-a", role: "共有者" as const };
    const candidates = [
      { id: "shared-b", role: "共有者" as const },
      { id: "wolf", role: "人狼" as const },
    ];
    const suspicion = new Map([
      ["shared-b", 100],
      ["wolf", 0],
    ]);
    expect(chooseNpcVoteTarget(actor, candidates, suspicion, () => 0)).toBe(
      "wolf",
    );
    expect(
      chooseNpcRevoteTarget(
        actor,
        candidates,
        suspicion,
        "shared-b",
        new Map([["shared-b", 3]]),
        () => 0,
      ),
    ).toBe("wolf");
    expect(
      chooseNpcVoteTarget(actor, candidates.slice(0, 1), suspicion, () => 0),
    ).toBeUndefined();
    expect(
      chooseNpcRevoteTarget(
        actor,
        candidates.slice(0, 1),
        suspicion,
        "shared-b",
        new Map([["shared-b", 3]]),
        () => 0,
      ),
    ).toBeUndefined();
  });

  it("慎重派は証拠を優先し、直感派は大きく揺れる", () => {
    const candidates = [
      { id: "evidence", role: "村人" as const },
      { id: "hunch", role: "村人" as const },
    ];
    const suspicion = new Map([
      ["evidence", 1],
      ["hunch", 0],
    ]);
    const randomValues = () => {
      const values = [0, 1];
      return () => values.shift() ?? 0;
    };

    expect(
      chooseNpcVoteTarget(
        { id: "npc", role: "村人", npcPersonality: "慎重" },
        candidates,
        suspicion,
        randomValues(),
      ),
    ).toBe("evidence");
    expect(
      chooseNpcVoteTarget(
        { id: "npc", role: "村人", npcPersonality: "直感" },
        candidates,
        suspicion,
        randomValues(),
      ),
    ).toBe("hunch");
  });

  it("再投票では慎重派は票を維持し、直感派は乗り換える", () => {
    const candidates = [
      { id: "first", role: "村人" as const },
      { id: "second", role: "村人" as const },
    ];
    const counts = new Map([
      ["first", 2],
      ["second", 2],
    ]);

    expect(
      chooseNpcRevoteTarget(
        { id: "npc", role: "村人", npcPersonality: "慎重" },
        candidates,
        new Map(),
        "first",
        counts,
        () => 0,
      ),
    ).toBe("first");
    expect(
      chooseNpcRevoteTarget(
        { id: "npc", role: "村人", npcPersonality: "直感" },
        candidates,
        new Map(),
        "first",
        counts,
        () => 0,
      ),
    ).toBe("second");
  });

  it("再投票では同調派は得票、追及派は証拠を優先する", () => {
    const candidates = [
      { id: "evidence", role: "村人" as const },
      { id: "popular", role: "村人" as const },
    ];
    const counts = new Map([
      ["evidence", 1],
      ["popular", 3],
    ]);
    const suspicion = new Map([
      ["evidence", 2],
      ["popular", 0],
    ]);

    expect(
      chooseNpcRevoteTarget(
        { id: "npc", role: "村人", npcPersonality: "同調" },
        candidates,
        new Map(),
        "evidence",
        counts,
        () => 0,
      ),
    ).toBe("popular");
    expect(
      chooseNpcRevoteTarget(
        { id: "npc", role: "村人", npcPersonality: "追及" },
        candidates,
        suspicion,
        "popular",
        counts,
        () => 0,
      ),
    ).toBe("evidence");
  });
});
