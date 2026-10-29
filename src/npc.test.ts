import { describe, expect, it } from "vitest";
import {
  claimConcernForPlayer,
  chooseNpcSeerClaimPlan,
  chooseNpcQuestionAnswer,
  combinedSuspicion,
  conflictingSeerClaimantIds,
  findNpcInsight,
  humanArgumentScore,
  isHumanArgumentSupported,
  npcDecisionSuspicion,
  npcOpinionLine,
  npcSeerClaimPlanStartsOnDay,
  personalityForSerial,
  planNpcSeerClaims,
  chooseStrategicNightTarget,
} from "./npc";
import { chooseNpcVoteTarget, chooseNpcRevoteTarget } from "./solo";
import type { GameState, Player } from "./types";

type QuestionGame = Pick<
  GameState,
  | "day"
  | "players"
  | "roleConfig"
  | "npcSuspicion"
  | "npcMemory"
  | "humanSuspicions"
  | "npcClaims"
  | "voteHistory"
  | "executionHistory"
>;

function questionPlayer(
  id: string,
  role: Player["role"],
  isNpc = true,
): Player {
  return {
    id,
    name: id,
    user: null,
    isNpc,
    role,
    alive: true,
    npcPersonality: isNpc ? "慎重" : undefined,
  };
}

describe("NPCの占い騙り方針", () => {
  it("人狼は人数に応じて初日・2日目・騙らないを一度だけ決める", () => {
    expect(chooseNpcSeerClaimPlan("人狼", 2, () => 0.19)).toBe("day1");
    expect(chooseNpcSeerClaimPlan("人狼", 2, () => 0.2)).toBe("day2");
    expect(chooseNpcSeerClaimPlan("人狼", 2, () => 0.31)).toBe("never");

    expect(chooseNpcSeerClaimPlan("人狼", 1, () => 0.29)).toBe("day1");
    expect(chooseNpcSeerClaimPlan("人狼", 1, () => 0.3)).toBe("day2");
    expect(chooseNpcSeerClaimPlan("人狼", 1, () => 0.4)).toBe("never");
  });

  it("狂人は45%で初日、25%で2日目に騙り始める", () => {
    expect(chooseNpcSeerClaimPlan("狂人", 1, () => 0.44)).toBe("day1");
    expect(chooseNpcSeerClaimPlan("狂人", 1, () => 0.45)).toBe("day2");
    expect(chooseNpcSeerClaimPlan("狂人", 1, () => 0.7)).toBe("never");
  });

  it("人狼と狂人のNPCだけに試合単位の方針を割り当てる", () => {
    const players = [
      questionPlayer("wolf", "人狼"),
      questionPlayer("madman", "狂人"),
      questionPlayer("seer", "占い師"),
      questionPlayer("human", "人狼", false),
    ];
    const plans = planNpcSeerClaims(players, () => 0);
    expect(plans).toEqual(
      new Map([
        ["wolf", "day1"],
        ["madman", "day1"],
      ]),
    );
  });

  it("占い師0人の公開配役では人狼も狂人も占いを騙らない", () => {
    const players = [
      questionPlayer("wolf", "人狼"),
      questionPlayer("madman", "狂人"),
      questionPlayer("villager", "村人"),
    ];

    expect(planNpcSeerClaims(players, () => 0)).toEqual(new Map());
  });

  it("潜伏解除は予定した日だけで、3日目以降には新規COしない", () => {
    expect(npcSeerClaimPlanStartsOnDay("day1", 1)).toBe(true);
    expect(npcSeerClaimPlanStartsOnDay("day1", 2)).toBe(false);
    expect(npcSeerClaimPlanStartsOnDay("day2", 2)).toBe(true);
    expect(npcSeerClaimPlanStartsOnDay("day2", 3)).toBe(false);
    expect(npcSeerClaimPlanStartsOnDay("never", 1)).toBe(false);
  });
});

function questionGame(players: Player[]): QuestionGame {
  return {
    day: 1,
    players,
    roleConfig: {
      村人: players.filter((player) => player.role === "村人").length,
      人狼: players.filter((player) => player.role === "人狼").length,
      狂人: players.filter((player) => player.role === "狂人").length,
      占い師: players.filter((player) => player.role === "占い師").length,
      騎士: players.filter((player) => player.role === "騎士").length,
      霊能者: players.filter((player) => player.role === "霊能者").length,
    },
    npcSuspicion: new Map(),
    npcMemory: new Map(),
    humanSuspicions: new Map(),
    npcClaims: [],
    voteHistory: [],
    executionHistory: [],
  };
}

describe("NPCの非公開情報に対する公平性", () => {
  it("擁護は公開白が必要で、黒判定があれば通らず、真の役職を参照しない", () => {
    const observer = questionPlayer("observer", "村人");
    const target = questionPlayer("target", "人狼");
    const seer = questionPlayer("seer", "村人");
    const game = questionGame([observer, target, seer]);
    const argument = { targetId: "target", reason: "white-defense" as const };
    expect(isHumanArgumentSupported(game, argument)).toBe(false);
    game.npcClaims.push({
      day: 1,
      speakerId: "seer",
      claimedRole: "占い師",
      targetId: "target",
      result: "人間",
    });
    expect(humanArgumentScore(game, argument)).toBe(-0.6);
    target.role = "村人";
    seer.role = "人狼";
    expect(humanArgumentScore(game, argument)).toBe(-0.6);
    game.npcClaims.push({
      day: 1,
      speakerId: "other",
      claimedRole: "占い師",
      targetId: "target",
      result: "人狼",
    });
    expect(isHumanArgumentSupported(game, argument)).toBe(false);
  });
  it("擁護を多人数で重ねても影響は一定以上増えない", () => {
    const observer = questionPlayer("observer", "村人");
    const target = questionPlayer("target", "村人");
    const seer = questionPlayer("seer", "占い師");
    const humans = Array.from({ length: 8 }, (_, i) =>
      questionPlayer(`human${i}`, "村人", false),
    );
    const game = questionGame([observer, target, seer, ...humans]);
    game.npcClaims.push({
      day: 1,
      speakerId: "seer",
      claimedRole: "占い師",
      targetId: "target",
      result: "人間",
    });
    for (const human of humans.slice(0, 4))
      game.humanSuspicions.set(human.id, {
        targetId: "target",
        reason: "white-defense",
      });
    const four = npcDecisionSuspicion(game, observer).get("target");
    for (const human of humans)
      game.humanSuspicions.set(human.id, {
        targetId: "target",
        reason: "white-defense",
      });
    expect(npcDecisionSuspicion(game, observer).get("target")).toBe(four);
  });
  it.each([
    "村人",
    "騎士",
    "霊能者",
    "検死官",
    "タフガイ",
    "逃亡者",
    "暗殺者",
    "猫又",
    "方位磁針",
    "狼憑き",
    "呪われた村人",
    "パン屋",
    "市長",
    "怪盗",
  ] as const)(
    "%s NPCは他人の真の役職を入れ替えても推理・質問・投票を変えない",
    (role) => {
      const observer = questionPlayer("observer", role);
      const first = questionPlayer("a", "人狼", false);
      const second = questionPlayer("b", "村人", false);
      const seer = questionPlayer("seer", "占い師");
      const g = questionGame([observer, first, second, seer]);
      g.day = 2;
      g.npcClaims.push({
        speakerId: "seer",
        claimedRole: "占い師",
        targetId: "a",
        result: "人狼",
        day: 2,
      });
      const before = npcDecisionSuspicion(g, observer);
      const answer = chooseNpcQuestionAnswer(g, observer);
      const targets = [first, second, seer];
      const vote = chooseNpcVoteTarget(observer, targets, before, () => 0.4);
      const revote = chooseNpcRevoteTarget(
        observer,
        targets,
        before,
        "b",
        new Map(),
        () => 0.4,
      );
      first.role = "村人";
      second.role = "人狼";
      const after = npcDecisionSuspicion(g, observer);
      expect([...after]).toEqual([...before]);
      expect(chooseNpcQuestionAnswer(g, observer)).toEqual(answer);
      expect(chooseNpcVoteTarget(observer, targets, after, () => 0.4)).toBe(
        vote,
      );
      expect(
        chooseNpcRevoteTarget(
          observer,
          targets,
          after,
          "b",
          new Map(),
          () => 0.4,
        ),
      ).toBe(revote);
    },
  );

  it("襲撃・護衛の優先度は真の役職ではなく公開COに基づく", () => {
    const first = questionPlayer("a", "占い師", false);
    const second = questionPlayer("b", "村人", false);
    for (const action of ["kill", "guard"] as const) {
      const before = chooseStrategicNightTarget(
        action,
        [first, second],
        () => undefined,
        () => 0.4,
      )?.id;
      [first.role, second.role] = [second.role, first.role];
      expect(
        chooseStrategicNightTarget(
          action,
          [first, second],
          () => undefined,
          () => 0.4,
        )?.id,
      ).toBe(before);
    }
  });
});

describe("NPCの性格", () => {
  it("NPCごとに固定の性格を割り当てる", () => {
    expect([1, 2, 3, 4, 5].map(personalityForSerial)).toEqual([
      "慎重",
      "直感",
      "追及",
      "同調",
      "慎重",
    ]);
  });

  it("性格によって共有情報と記憶の重みが変わる", () => {
    const shared = new Map([["a", 2]]);
    const memory = new Map([["b", 2]]);
    expect(combinedSuspicion(shared, memory, "同調").get("a")).toBe(2.4);
    expect(combinedSuspicion(shared, memory, "慎重").get("a")).toBe(0.9);
    expect(combinedSuspicion(shared, memory, "追及").get("b")).toBe(3);
  });

  it("性格ごとに一貫した口調を使う", () => {
    expect(npcOpinionLine("慎重", "レン")).toContain("断定はしない");
    expect(npcOpinionLine("追及", "レン")).toContain("説明してほしい");
  });
});

describe("NPCの推理", () => {
  it("占い師3人設定では3人のCOだけで対抗扱いしない", () => {
    const first = questionPlayer("first", "占い師");
    const second = questionPlayer("second", "占い師");
    const third = questionPlayer("third", "占い師");
    const target = questionPlayer("target", "村人");
    const other = questionPlayer("other", "村人");
    const game = questionGame([first, second, third, target, other]);
    game.npcClaims.push(
      {
        day: 1,
        speakerId: first.id,
        claimedRole: "占い師",
        targetId: target.id,
        result: "人狼",
      },
      {
        day: 1,
        speakerId: second.id,
        claimedRole: "占い師",
        targetId: other.id,
        result: "人間",
      },
      {
        day: 1,
        speakerId: third.id,
        claimedRole: "占い師",
        targetId: other.id,
        result: "人間",
      },
    );

    expect(claimConcernForPlayer(game, first.id)).toBeUndefined();
    expect(
      isHumanArgumentSupported(game, {
        targetId: first.id,
        reason: "counter-claim",
      }),
    ).toBe(false);
  });

  it("占い師枠を超えた4人目のCOは全CO者の確認材料になる", () => {
    const first = questionPlayer("first", "占い師");
    const second = questionPlayer("second", "占い師");
    const third = questionPlayer("third", "占い師");
    const fake = questionPlayer("fake", "村人");
    const target = questionPlayer("target", "村人");
    const game = questionGame([first, second, third, fake, target]);
    for (const speaker of [first, second, third, fake]) {
      game.npcClaims.push({
        day: 1,
        speakerId: speaker.id,
        claimedRole: "占い師",
        targetId: target.id,
        result: "人間",
      });
    }

    expect(claimConcernForPlayer(game, first.id)).toBe("over-capacity");
    expect(claimConcernForPlayer(game, fake.id)).toBe("over-capacity");
    expect(
      isHumanArgumentSupported(game, {
        targetId: fake.id,
        reason: "counter-claim",
      }),
    ).toBe(true);
  });

  it("同じ相手への白黒割れは、枠内でも両占いCOの確認材料になる", () => {
    const first = questionPlayer("first", "占い師");
    const second = questionPlayer("second", "占い師");
    const target = questionPlayer("target", "村人");
    const game = questionGame([first, second, target]);
    game.npcClaims.push(
      {
        day: 1,
        speakerId: first.id,
        claimedRole: "占い師",
        targetId: target.id,
        result: "人狼",
      },
      {
        day: 1,
        speakerId: second.id,
        claimedRole: "占い師",
        targetId: target.id,
        result: "人間",
      },
    );

    expect([...conflictingSeerClaimantIds(game.npcClaims)].sort()).toEqual([
      first.id,
      second.id,
    ]);
    expect(claimConcernForPlayer(game, first.id)).toBe("result-conflict");
    expect(claimConcernForPlayer(game, second.id)).toBe("result-conflict");
  });

  it("占い師2人の同じ黒判定は、1人だけの黒判定より強く見る", () => {
    const observer = questionPlayer("observer", "村人");
    observer.npcPersonality = "慎重";
    const first = questionPlayer("first", "占い師");
    const second = questionPlayer("second", "占い師");
    const target = questionPlayer("target", "人狼");
    const game = questionGame([observer, first, second, target]);
    game.npcClaims.push({
      day: 1,
      speakerId: first.id,
      claimedRole: "占い師",
      targetId: target.id,
      result: "人狼",
    });
    const singleScore =
      npcDecisionSuspicion(game, observer).get(target.id) ?? 0;

    game.npcClaims.push({
      day: 1,
      speakerId: second.id,
      claimedRole: "占い師",
      targetId: target.id,
      result: "人狼",
    });
    const corroboratedScore =
      npcDecisionSuspicion(game, observer).get(target.id) ?? 0;

    expect(corroboratedScore).toBeGreaterThan(singleScore);
  });

  it("公開情報に合う根拠だけに説得力を与える", () => {
    const claimant = questionPlayer("claimant", "村人");
    const target = questionPlayer("target", "村人");
    const rival = questionPlayer("rival", "村人");
    const observer = questionPlayer("observer", "村人");
    const game = questionGame([claimant, target, rival, observer]);
    game.day = 2;
    game.npcClaims.push(
      {
        day: 1,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: target.id,
        result: "人狼",
      },
      {
        day: 1,
        speakerId: rival.id,
        claimedRole: "占い師",
        targetId: observer.id,
        result: "人間",
      },
    );
    game.voteHistory.push({
      day: 1,
      round: 1,
      ballots: [
        { voterId: claimant.id, targetId: rival.id },
        { voterId: target.id, targetId: claimant.id },
        { voterId: rival.id, targetId: claimant.id },
      ],
    });

    expect(
      humanArgumentScore(game, {
        targetId: claimant.id,
        reason: "vote-contradiction",
      }),
    ).toBe(2);
    expect(
      humanArgumentScore(game, {
        targetId: claimant.id,
        reason: "counter-claim",
      }),
    ).toBe(0.6);
    expect(
      humanArgumentScore(game, {
        targetId: claimant.id,
        reason: "previous-votes",
      }),
    ).toBe(0.4);
    expect(
      isHumanArgumentSupported(game, {
        targetId: observer.id,
        reason: "black-result",
      }),
    ).toBe(false);
  });

  it("占い結果と投票先の矛盾を翌日に指摘する", () => {
    const insight = findNpcInsight(
      [
        {
          day: 1,
          speakerId: "seer",
          claimedRole: "占い師",
          targetId: "wolf",
          result: "人狼",
        },
      ],
      [
        {
          day: 1,
          round: 1,
          ballots: [{ voterId: "seer", targetId: "other" }],
        },
      ],
      "observer",
      new Set(["seer", "wolf", "other", "observer"]),
    );
    expect(insight).toEqual({
      suspectId: "seer",
      reason: "人狼判定を出した相手とは別の人へ投票していた",
    });
  });

  it("霊能結果と投票先は比較しない", () => {
    const insight = findNpcInsight(
      [
        {
          day: 2,
          speakerId: "medium",
          claimedRole: "霊能者",
          targetId: "dead",
          result: "人狼",
        },
      ],
      [
        {
          day: 2,
          round: 1,
          ballots: [{ voterId: "medium", targetId: "alive" }],
        },
      ],
      "observer",
      new Set(["medium", "alive", "observer"]),
    );
    expect(insight).toBeNull();
  });

  it("対抗COの発言順だけでは片方を偽物扱いしない", () => {
    const insight = findNpcInsight(
      [
        {
          day: 1,
          speakerId: "first",
          claimedRole: "占い師",
          targetId: "target",
          result: "人狼",
        },
        {
          day: 1,
          speakerId: "second",
          claimedRole: "占い師",
          targetId: "target",
          result: "人間",
        },
      ],
      [],
      "observer",
      new Set(["first", "second", "target", "observer"]),
    );
    expect(insight).toBeNull();
  });

  it("質問には公開された人狼判定を理由として答える", () => {
    const observer = questionPlayer("レン", "村人");
    const seer = questionPlayer("ミオ", "占い師");
    const target = questionPlayer("アカネ", "人狼");
    const game = questionGame([observer, seer, target]);
    game.npcSuspicion.set(target.id, 1.25);
    game.npcClaims.push({
      day: 1,
      speakerId: seer.id,
      claimedRole: "占い師",
      targetId: target.id,
      result: "人狼",
    });

    expect(chooseNpcQuestionAnswer(game, observer)).toEqual({
      targetId: target.id,
      reason: "占い師COから人狼判定が出ている",
    });
  });

  it("質問では占いCOと投票の矛盾を優先して説明する", () => {
    const observer = questionPlayer("レン", "村人");
    const claimant = questionPlayer("ミオ", "村人");
    const blackTarget = questionPlayer("アカネ", "村人");
    const other = questionPlayer("ユズ", "村人");
    const game = questionGame([observer, claimant, blackTarget, other]);
    game.day = 2;
    game.npcClaims.push({
      day: 1,
      speakerId: claimant.id,
      claimedRole: "占い師",
      targetId: blackTarget.id,
      result: "人狼",
    });
    game.voteHistory.push({
      day: 1,
      round: 1,
      ballots: [{ voterId: claimant.id, targetId: other.id }],
    });

    expect(chooseNpcQuestionAnswer(game, observer)).toEqual({
      targetId: claimant.id,
      reason: "人狼判定を出した相手とは別の人へ投票していた",
    });
  });

  it("人狼NPCは質問で仲間の人狼を告発しない", () => {
    const wolf = questionPlayer("レン", "人狼");
    const ally = questionPlayer("アカネ", "人狼");
    const villager = questionPlayer("ミオ", "村人", false);
    const game = questionGame([wolf, ally, villager]);
    game.npcSuspicion.set(ally.id, 2.5);
    game.npcSuspicion.set(villager.id, 0.1);

    expect(chooseNpcQuestionAnswer(game, wolf)?.targetId).toBe(villager.id);
  });

  it("狂人NPCは人狼を知らず、公開情報への逆張りで人狼も疑える", () => {
    const madman = questionPlayer("a", "狂人");
    const wolf = questionPlayer("アカネ", "人狼");
    const villager = questionPlayer("ミオ", "村人", false);
    const game = questionGame([madman, wolf, villager]);
    game.npcSuspicion.set(villager.id, 2);

    expect(chooseNpcQuestionAnswer(game, madman)?.targetId).toBe(wolf.id);
  });

  it("自分で人間判定を出した相手を質問回答で疑わない", () => {
    const madman = questionPlayer("a", "狂人");
    const whiteTarget = questionPlayer("ソラ", "村人", false);
    const other = questionPlayer("ミオ", "村人", false);
    const game = questionGame([madman, whiteTarget, other]);
    game.npcClaims.push({
      day: 1,
      speakerId: madman.id,
      claimedRole: "占い師",
      targetId: whiteTarget.id,
      result: "人間",
    });
    game.npcSuspicion.set(whiteTarget.id, -0.4);

    expect(chooseNpcQuestionAnswer(game, madman)?.targetId).toBe(other.id);
  });

  it("自分で人狼判定を出した相手は質問回答でも優先する", () => {
    const npc = questionPlayer("アカネ", "狂人");
    const blackTarget = questionPlayer("ソラ", "村人", false);
    const other = questionPlayer("ミオ", "村人", false);
    const game = questionGame([npc, blackTarget, other]);
    game.npcClaims.push({
      day: 1,
      speakerId: npc.id,
      claimedRole: "占い師",
      targetId: blackTarget.id,
      result: "人狼",
    });

    expect(chooseNpcQuestionAnswer(game, npc)).toEqual({
      targetId: blackTarget.id,
      reason: "自分の占い師COで人狼判定を出している",
    });
  });

  it("生存者全員へ人間判定を出しているなら無理に疑わない", () => {
    const npc = questionPlayer("アカネ", "狂人");
    const whiteTarget = questionPlayer("ソラ", "村人", false);
    const game = questionGame([npc, whiteTarget]);
    game.npcClaims.push({
      day: 1,
      speakerId: npc.id,
      claimedRole: "占い師",
      targetId: whiteTarget.id,
      result: "人間",
    });

    expect(chooseNpcQuestionAnswer(game, npc)).toEqual({
      reason: "自分の占い師COでは、生存者を人間と判定している",
    });
  });
});
