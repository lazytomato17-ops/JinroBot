import { describe, expect, it } from "vitest";
import {
  chooseNpcQuestionAnswer,
  findNpcInsight,
  isHumanArgumentSupported,
  npcDecisionSuspicion,
  npcSuspicionReason,
  takeNpcPersuasionReaction,
} from "./npc";
import { roleConfigFromRoles } from "./roles";
import { chooseNpcVoteTarget } from "./solo";
import type { Player, RoleName } from "./types";

function setup() {
  const roles: RoleName[] = [
    "村人",
    "村人",
    "占い師",
    "狂人",
    "村人",
    "騎士",
    "人狼",
  ];
  const players: Player[] = roles.map((role, index) => ({
    id: String(index),
    name: String(index),
    role,
    user: null,
    alive: true,
    isNpc: index !== 0,
    npcPersonality: "慎重",
  }));
  const game: Parameters<typeof npcDecisionSuspicion>[0] = {
    day: 2,
    players,
    roleConfig: roleConfigFromRoles(roles),
    npcSuspicion: new Map(),
    npcMemory: new Map(),
    npcClaims: [],
    humanSuspicions: new Map(),
    voteHistory: [],
    executionHistory: [],
  };
  return { game, observer: players[1], players };
}

function disputedBlack() {
  const state = setup();
  state.game.npcClaims.push(
    {
      day: 1,
      speakerId: "3",
      claimedRole: "占い師",
      targetId: "4",
      result: "人狼",
    },
    {
      day: 1,
      speakerId: "2",
      claimedRole: "占い師",
      targetId: "4",
      result: "人間",
    },
  );
  state.game.npcSuspicion.set("4", 0.85);
  return state;
}

function persuasionSetup() {
  const state = setup();
  state.game.npcMemory.set("1", new Map([["5", 0.1]]));
  state.game.voteHistory.push({
    day: 1,
    round: 1,
    ballots: [
      { voterId: "2", targetId: "4" },
      { voterId: "3", targetId: "4" },
    ],
  });
  return state;
}

describe("公開情報による信用更新と説得", () => {
  it.each(["饒舌な人狼", "狼憑き", "呪われた村人"] as const)(
    "%s入りの配役で正当な黒結果を破綻扱いしない",
    (role) => {
      const { game } = setup();
      game.roleConfig[role] = 1;
      game.npcClaims.push(
        {
          day: 1,
          speakerId: "2",
          claimedRole: "占い師",
          targetId: "4",
          result: "人狼",
        },
        {
          day: 2,
          speakerId: "2",
          claimedRole: "占い師",
          targetId: "5",
          result: "人狼",
        },
      );
      game.players[4].alive = false;
      game.executionHistory.push(game.players[4]);
      expect(
        isHumanArgumentSupported(game, {
          targetId: "2",
          reason: "broken-claim",
        }),
      ).toBe(false);
    },
  );

  it("潜伏解除で2件の黒をまとめて出し、片方へ投票しても矛盾扱いしない", () => {
    const { game, observer } = disputedBlack();
    game.roleConfig.人狼 = 2;
    game.npcClaims[0].day = 2;
    game.npcClaims[0].resultDay = 1;
    game.npcClaims.push({
      day: 2,
      resultDay: 2,
      speakerId: "3",
      claimedRole: "占い師",
      targetId: "5",
      result: "人狼",
    });
    const before = [...npcDecisionSuspicion(game, observer)];
    game.voteHistory.push({
      day: 2,
      round: 1,
      ballots: [{ voterId: "3", targetId: "5" }],
    });
    expect(
      findNpcInsight(
        game.npcClaims,
        game.voteHistory,
        observer.id,
        new Set(game.players.map((player) => player.id)),
      ),
    ).toBeNull();
    expect([...npcDecisionSuspicion(game, observer)]).toEqual(before);
  });

  it("既に死亡し投票時の生存も確認できない黒先へ投票しなくても責めない", () => {
    const { game, observer } = disputedBlack();
    game.players[4].alive = false;
    const before = [...npcDecisionSuspicion(game, observer)];
    game.voteHistory.push({
      day: 1,
      round: 1,
      ballots: [{ voterId: "3", targetId: "5" }],
    });
    expect(
      findNpcInsight(
        game.npcClaims,
        game.voteHistory,
        observer.id,
        new Set(
          game.players
            .filter((player) => player.alive)
            .map((player) => player.id),
        ),
      ),
    ).toBeNull();
    expect([...npcDecisionSuspicion(game, observer)]).toEqual(before);
  });

  it("対抗がいてもCO順だけでは片方の信用を下げない", () => {
    const { game, observer } = disputedBlack();
    const first = [...npcDecisionSuspicion(game, observer)];
    game.npcClaims.reverse();
    expect([...npcDecisionSuspicion(game, observer)]).toEqual(first);
    expect(npcDecisionSuspicion(game, observer).get("3") ?? 0).toBe(0);
  });

  it("黒先とは別に投票した対抗の信用を下げ、質問でもその根拠を示す", () => {
    const { game, observer } = disputedBlack();
    const initial = npcDecisionSuspicion(game, observer).get("4") ?? 0;
    game.voteHistory.push({
      day: 1,
      round: 1,
      ballots: [
        { voterId: "3", targetId: "5" },
        { voterId: "4", targetId: "3" },
      ],
    });
    const scores = npcDecisionSuspicion(game, observer);
    expect(scores.get("4") ?? 0).toBeLessThan(initial);
    expect(scores.get("3") ?? 0).toBeGreaterThan(0);
    expect(chooseNpcQuestionAnswer(game, observer)).toEqual({
      targetId: "3",
      reason: "人狼判定を出した相手とは別の人へ投票していた",
    });
    expect(npcSuspicionReason(game, observer, game.players[3])).toContain(
      "別の人へ投票",
    );
  });

  it("同じ公開情報なら他人の秘密役職を入れ替えても判断が変わらない", () => {
    const { game, observer } = disputedBlack();
    const before = [...npcDecisionSuspicion(game, observer)];
    [game.players[3].role, game.players[6].role] = [
      game.players[6].role,
      game.players[3].role,
    ];
    expect([...npcDecisionSuspicion(game, observer)]).toEqual(before);
  });

  it("公開された矛盾は説明だけでなく実際の投票傾向も変える", () => {
    const { game, observer } = disputedBlack();
    const before = npcDecisionSuspicion(game, observer);
    game.voteHistory.push({
      day: 1,
      round: 1,
      ballots: [
        { voterId: "3", targetId: "5" },
        { voterId: "4", targetId: "3" },
      ],
    });
    const after = npcDecisionSuspicion(game, observer);
    const rate = (scores: ReadonlyMap<string, number>) => {
      let seed = 42;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      let votes = 0;
      for (let index = 0; index < 10000; index++) {
        if (chooseNpcVoteTarget(observer, game.players, scores, random) === "3")
          votes++;
      }
      return votes / 10000;
    };
    expect(rate(after)).toBeGreaterThan(rate(before) + 0.2);
  });

  it("根拠の薄い直感は、追及型より直感型に影響する", () => {
    const { game, observer } = setup();
    game.humanSuspicions.set("0", { targetId: "4", reason: "intuition" });
    observer.npcPersonality = "追及";
    const questioning = npcDecisionSuspicion(game, observer).get("4") ?? 0;
    observer.npcPersonality = "直感";
    expect(npcDecisionSuspicion(game, observer).get("4") ?? 0).toBeGreaterThan(
      questioning,
    );
  });

  it("唯一COの黒判定を優先し、唯一CO保護も維持する", () => {
    const { game, observer } = disputedBlack();
    game.day = 1;
    game.npcClaims = [game.npcClaims[0]];
    game.npcSuspicion.set("4", 1.25);
    const scores = npcDecisionSuspicion(game, observer);
    expect(scores.get("4")).toBeCloseTo(1.6875);
    expect(scores.get("3")).toBe(-2.5);
    const candidates = game.players.filter(
      (player) => player.id !== observer.id,
    );
    expect(chooseNpcVoteTarget(observer, candidates, scores, () => 0)).toBe(
      "4",
    );
  });

  it("質問が共有スコアだけでなく、投票と同じ個別記憶を参照する", () => {
    const { game, observer } = setup();
    game.npcMemory.set(observer.id, new Map([["5", 3]]));
    expect(chooseNpcQuestionAnswer(game, observer)?.targetId).toBe("5");
    expect(
      chooseNpcVoteTarget(
        observer,
        game.players,
        npcDecisionSuspicion(game, observer),
        () => 0,
      ),
    ).toBe("5");
    expect(chooseNpcQuestionAnswer(game, observer)).toEqual(
      chooseNpcQuestionAnswer(game, observer),
    );
  });

  it("共有者は質問でも既知の相方を疑わない", () => {
    const { game, observer } = setup();
    observer.role = "共有者";
    game.players[5].role = "共有者";
    game.npcMemory.set(observer.id, new Map([["5", 100]]));
    expect(chooseNpcQuestionAnswer(game, observer)?.targetId).not.toBe("5");
  });

  it("根拠のある意見で見方が変わったNPCだけが反応する", () => {
    const { game, observer } = persuasionSetup();
    const before = new Map([
      [observer.id, chooseNpcQuestionAnswer(game, observer)],
    ]);
    expect(before.get(observer.id)?.targetId).toBe("5");
    game.humanSuspicions.set("0", { targetId: "4", reason: "previous-votes" });
    expect(takeNpcPersuasionReaction(game, "0", before)).toEqual({
      npcId: observer.id,
      targetId: "4",
      reason: "疑う意見が1人から出ている",
    });
    expect(takeNpcPersuasionReaction(game, "0", before)).toBeNull();
  });

  it("指摘を繰り返してもスコアや記憶が積み増されない", () => {
    const { game, observer } = persuasionSetup();
    game.humanSuspicions.set("0", { targetId: "4", reason: "previous-votes" });
    const expected = [...npcDecisionSuspicion(game, observer)];
    for (let count = 0; count < 100; count++) {
      expect([...npcDecisionSuspicion(game, observer)]).toEqual(expected);
    }
    expect([...game.npcMemory.get(observer.id)!]).toEqual([["5", 0.1]]);
    expect(game.npcSuspicion.size).toBe(0);
  });

  it("直感だけ・偽の根拠・死者の意見には説得成功の反応をしない", () => {
    for (const reason of ["intuition", "broken-claim"] as const) {
      const { game, observer } = persuasionSetup();
      const before = new Map([
        [observer.id, chooseNpcQuestionAnswer(game, observer)],
      ]);
      game.humanSuspicions.set("0", { targetId: "4", reason });
      expect(takeNpcPersuasionReaction(game, "0", before)).toBeNull();
    }
    const { game, observer } = persuasionSetup();
    const before = new Map([
      [observer.id, chooseNpcQuestionAnswer(game, observer)],
    ]);
    game.players[0].alive = false;
    game.humanSuspicions.set("0", { targetId: "4", reason: "previous-votes" });
    expect(takeNpcPersuasionReaction(game, "0", before)).toBeNull();
    expect(npcDecisionSuspicion(game, observer).get("4") ?? 0).toBe(0);
  });

  it("すでに同じ相手を疑っていれば、説得で変わったふりをしない", () => {
    const { game, observer } = persuasionSetup();
    game.npcMemory.set(observer.id, new Map([["4", 2]]));
    const before = new Map([
      [observer.id, chooseNpcQuestionAnswer(game, observer)],
    ]);
    game.humanSuspicions.set("0", { targetId: "4", reason: "previous-votes" });
    expect(takeNpcPersuasionReaction(game, "0", before)).toBeNull();
  });

  it("観測対象から外したNPCには反応させない（別の分断部屋）", () => {
    const { game } = persuasionSetup();
    game.humanSuspicions.set("0", { targetId: "4", reason: "previous-votes" });
    expect(takeNpcPersuasionReaction(game, "0", new Map())).toBeNull();
  });
});
