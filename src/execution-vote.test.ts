import { describe, expect, it } from "vitest";
import { chooseNpcExecutionBallot } from "./execution-vote";
import { NO_EXECUTION_VOTE } from "./presentation";
import { roleConfigFromRoles } from "./roles";
import type { GameState, RoleName } from "./types";

function fixture(
  roles: RoleName[] = ["村人", "人狼", "村人", "占い師", "騎士", "村人"],
) {
  const players = roles.map((role, i) => ({
    id: String(i),
    name: String(i),
    role,
    isNpc: true,
    user: null,
    alive: true,
    npcPersonality: "慎重" as const,
  }));
  return {
    players,
    day: 1,
    roleConfig: roleConfigFromRoles(roles),
    npcClaims: [],
    npcSuspicion: new Map(),
    npcMemory: new Map(),
    humanSuspicions: new Map(),
    executionHistory: [],
    voteHistory: [],
  } as Pick<
    GameState,
    | "players"
    | "day"
    | "roleConfig"
    | "npcClaims"
    | "npcSuspicion"
    | "npcMemory"
    | "humanSuspicions"
    | "executionHistory"
    | "voteHistory"
  >;
}
describe("NPCの処刑見送り票", () => {
  it("根拠が薄いと控えめに見送れるが、再投票候補になければ選ばない", () => {
    const g = fixture();
    const actor = g.players[0];
    expect(chooseNpcExecutionBallot(g, actor, g.players, true, () => 0)).toBe(
      NO_EXECUTION_VOTE,
    );
    expect(
      chooseNpcExecutionBallot(g, actor, g.players, false, () => 0),
    ).not.toBe(NO_EXECUTION_VOTE);
    expect(
      chooseNpcExecutionBallot(g, actor, g.players, true, () => 0.99),
    ).not.toBe(NO_EXECUTION_VOTE);
  });
  it("公開黒と強い疑いがある時は見送らず、終盤も見送りを乱用しない", () => {
    const g = fixture();
    const actor = g.players[0];
    g.npcClaims.push({
      speakerId: "3",
      targetId: "1",
      claimedRole: "占い師",
      result: "人狼",
      day: 1,
    });
    expect(
      chooseNpcExecutionBallot(g, actor, g.players, true, () => 0),
    ).not.toBe(NO_EXECUTION_VOTE);
    g.npcClaims = [];
    g.npcSuspicion.set("2", 4);
    expect(
      chooseNpcExecutionBallot(g, actor, g.players, true, () => 0),
    ).not.toBe(NO_EXECUTION_VOTE);
    g.npcSuspicion.clear();
    g.day = 3;
    expect(
      chooseNpcExecutionBallot(g, actor, g.players, true, () => 0),
    ).not.toBe(NO_EXECUTION_VOTE);
    g.day = 1;
    g.players = g.players.slice(0, 4);
    expect(
      chooseNpcExecutionBallot(g, actor, g.players, true, () => 0),
    ).not.toBe(NO_EXECUTION_VOTE);
  });
  it("相方しか処刑候補にいない共有者も、見送り候補があれば正しく投票できる", () => {
    const g = fixture(["共有者", "共有者", "人狼", "村人"]);
    expect(
      chooseNpcExecutionBallot(g, g.players[0], [g.players[1]], true, () => 0),
    ).toBe(NO_EXECUTION_VOTE);
    expect(
      chooseNpcExecutionBallot(g, g.players[0], [g.players[1]], false, () => 0),
    ).toBeUndefined();
  });
  it("見送り判断は他人の真の役職を入れ替えても同じ", () => {
    const g = fixture();
    const actor = g.players[0];
    const first = chooseNpcExecutionBallot(g, actor, g.players, true, () => 0);
    g.players[1].role = "村人";
    g.players[2].role = "人狼";
    expect(chooseNpcExecutionBallot(g, actor, g.players, true, () => 0)).toBe(
      first,
    );
  });
});
