import type { TextChannel } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import {
  abandonReasonFromAction,
  abandonReasonRows,
  applyPublicClaimSuspicion,
  autoSelectHumanSeer,
  availableClaimDays,
  availableTrueMediumClaims,
  availableTrueSeerClaims,
  canResetGame,
  chooseNpcAssassinationTarget,
  claimedRoleForPlayer,
  claimListEmbed,
  claimPanel,
  claimRoleRows,
  completeLoquaciousMissionForMessage,
  dayEmbed,
  divisionGroupsForPlayers,
  divisionRecoverySnapshotFromTopic,
  eliminateWithLovers,
  finishedDayEmbed,
  fillMissingNightAction,
  feedbackReasonRows,
  gameFeedbackRow,
  gameResultRow,
  gameStartEmbed,
  hasCurrentGameSession,
  hasConflictingSeerClaim,
  humanOpinionLine,
  interruptedGameEmbed,
  isTargetGuarded,
  livingHumanWolfAllies,
  lobbyPayload,
  mediumResultRecipients,
  nightEmbed,
  nightActionForPlayer,
  nextNpcSeerTarget,
  npcDecisionSuspicion,
  npcDiscussionSpeakers,
  npcFakeSeerClaimDays,
  npcPublicRoleClaim,
  npcQuestionLine,
  publicResultForRole,
  postgameRecapBatches,
  postgameRecapEmbeds,
  prepareRematchGame,
  parseGameComponentId,
  privateDeliveryWarning,
  recommendedLobbyRoleConfig,
  recordCurrentVoteRound,
  recordNightHistory,
  recordRoleClaim,
  recordRoleDeclaration,
  retractPlayerClaim,
  remainingNpcQuestions,
  remainingClaimSlots,
  remainingPhaseMinimumMs,
  remainingWolfChatMessages,
  resolveWolfTarget,
  roleClaimLine,
  roleConfigPanel,
  roleDeclarationLine,
  roleDmEmbed,
  sendMediumResults,
  shouldOfferAbandonReason,
  syncRecommendedLobbyRoleConfig,
  voteBallotFields,
  voteEmbed,
  voteTallyRows,
  weightedVoteTargetIds,
  usesUnrankedRoleConfig,
  wolfChatButtonRow,
  wolfChatRelayPayload,
} from "./game";
import { roleConfigFromRoles } from "./roles";
import { buildSoloRoles, chooseNpcVoteTarget } from "./solo";
import type { GameState, Player, RoleName } from "./types";

function makeGame(
  roles: RoleName[] = ["人狼", "占い師", "騎士", "村人"],
): GameState {
  const players: Player[] = roles.map((role, index) => ({
    id: String(index),
    name:
      index === 0 ? "とてもとてもとても長いプレイヤー名" : `プレイヤー${index}`,
    user: null,
    isNpc: index > 0,
    role,
    alive: true,
  }));
  return {
    channelId: "channel",
    channel: {} as TextChannel,
    hostId: "0",
    phase: "day",
    players,
    targetPlayerCount: players.length,
    roleConfig: roleConfigFromRoles(roles),
    roleDmSent: new Set(),
    roleDmFailures: new Set(),
    pendingDmMessages: new Map(),
    day: 1,
    voteRound: 1,
    voteCandidateIds: players.map((player) => player.id),
    phaseEndsAt: 1_750_000_000_000,
    votes: new Map(),
    voteHistory: [],
    nightChoices: new Map(),
    npcSuspicion: new Map(),
    npcMemory: new Map(),
    npcClaims: [],
    claimHistory: [],
    npcSeerClaimPlans: new Map(),
    roleDeclarations: new Set(),
    humanSuspicions: new Map(),
    npcQuestionCounts: new Map(),
    seerResults: new Map(),
    executionHistory: [],
    nightHistory: [],
    postgameRecapState: "idle",
    wolfChatCounts: new Map(),
    timers: [],
    resolving: false,
    resolutionQueued: false,
  };
}

function enableBetaHost(game: GameState): void {
  game.hostId = "1010400040797360218";
}

describe("ゲーム画面", () => {
  it("ゲーム終了理由は任意の5択で、保存値と表示を分離する", () => {
    const rows = abandonReasonRows(
      "12345678901234567890",
      "0190cf7d-2f0d-7cb3-b815-f59fb6adc95a",
    ).map((row) => row.toJSON());
    expect(rows.map((row) => row.components.length)).toEqual([3, 2]);
    const components = rows.flatMap((row) => row.components);
    expect(components.map((component) => component.label)).toEqual([
      "役職を変えたい",
      "配役を試していた",
      "操作が分からない",
      "長く感じた",
      "その他",
    ]);
    expect(
      components.every(
        (component) => (component.custom_id?.length ?? 101) <= 100,
      ),
    ).toBe(true);
    expect(abandonReasonFromAction("abandon-reroll")).toBe("reroll_role");
    expect(abandonReasonFromAction("abandon-testing")).toBe("testing_config");
    expect(abandonReasonFromAction("join")).toBeUndefined();

    const game = makeGame();
    expect(shouldOfferAbandonReason(game)).toBe(false);
    game.analyticsStartedAt = Date.now();
    expect(shouldOfferAbandonReason(game)).toBe(true);
    game.analyticsCompleted = true;
    expect(shouldOfferAbandonReason(game)).toBe(false);
    game.analyticsCompleted = false;
    game.phase = "ended";
    expect(shouldOfferAbandonReason(game)).toBe(false);
  });

  it("ゲーム終了はホストまたは管理者にだけ許可する", () => {
    const game = makeGame();
    expect(
      canResetGame(game, { userId: game.hostId, canManageMessages: false }),
    ).toBe(true);
    expect(
      canResetGame(game, { userId: "moderator", canManageMessages: true }),
    ).toBe(true);
    expect(
      canResetGame(game, { userId: "other", canManageMessages: false }),
    ).toBe(false);
  });

  it("議論画面は日本語タイトルと正確な相対時刻を使う", () => {
    const game = makeGame();
    const json = dayEmbed(game).toJSON();
    expect(json.title).toBe("1日目｜議論");
    expect(json.description).toContain("<t:1750000000:R>");
    expect(json.description).not.toContain("残り");
    expect(json.description).not.toContain("｜");
    expect(json.fields?.[0].value).toContain(
      "👤 とてもとてもとても長いプレイヤー名",
    );
    expect(json.fields?.[0].value).toContain("🤖 プレイヤー1");
    expect(finishedDayEmbed(game).toJSON()).toMatchObject({
      title: "1日目｜議論終了",
      description: "議論を終了しました。",
    });
  });

  it("再投票と夜の画面も同じ表記に揃える", () => {
    const game = makeGame();
    game.voteRound = 2;
    expect(voteEmbed(game).toJSON().title).toBe("1日目｜再投票");
    expect(nightEmbed(game).toJSON().title).toBe("1日目｜夜");
  });

  it("好評だった開始画面と役職DMの構成を維持する", () => {
    const game = makeGame();
    game.seerResults.set("1", [{ targetId: "0", isWolf: true }]);
    expect(gameStartEmbed(game).toJSON()).toMatchObject({
      title: "ゲーム開始｜4人",
      fields: [{ name: "配役" }],
    });
    expect(roleDmEmbed(game, game.players[1]).toJSON()).toMatchObject({
      title: "🔮 役職｜占い師",
      fields: [{ name: "勝利条件" }],
    });
  });

  it("試合終了後の主要操作を1列にまとめる", () => {
    const game = makeGame();
    game.phase = "ended";
    game.analyticsSessionId = "0190cf7d-2f0d-7cb3-b815-f59fb6adc95a";
    const row = gameResultRow(game, true).toJSON();
    expect(row.components.map((component) => component.label)).toEqual([
      "もう一度遊ぶ",
      "試合を振り返る",
      "気になる点を送る",
    ]);
    expect(row.components[2].custom_id).toBe(
      "tb:feedback-issue:channel:0190cf7d-2f0d-7cb3-b815-f59fb6adc95a",
    );

    const laterMatchRow = gameResultRow(game, false).toJSON();
    expect(
      laterMatchRow.components.map((component) => component.label),
    ).toEqual(["もう一度遊ぶ", "試合を振り返る"]);
  });

  it("連戦単位の感想理由を5個とその他に分けて表示する", () => {
    const game = makeGame();
    game.channelId = "12345678901234567890";
    game.analyticsSessionId = "11111111-1111-4111-8111-111111111111";
    game.analyticsChainId = "22222222-2222-4222-8222-222222222222";

    const ratingIds = gameFeedbackRow(game)
      .toJSON()
      .components.map((component) => component.custom_id);
    expect(ratingIds).toHaveLength(1);
    expect(ratingIds.every((id) => id?.endsWith(game.analyticsChainId!))).toBe(
      true,
    );
    expect(ratingIds.some((id) => id?.endsWith(game.analyticsSessionId!))).toBe(
      false,
    );

    const rows = feedbackReasonRows(game, "issue").map((row) => row.toJSON());
    expect(rows.map((row) => row.components.length)).toEqual([5, 1]);
    expect(
      rows.flatMap((row) => row.components.map((item) => item.label)),
    ).toEqual([
      "NPCの動き",
      "テンポ",
      "操作",
      "配役バランス",
      "不具合",
      "その他",
    ]);
    expect(
      rows
        .flatMap((row) => row.components)
        .every(
          (component) =>
            Boolean(component.custom_id?.endsWith(game.analyticsChainId!)) &&
            (component.custom_id?.length ?? 101) <= 100,
        ),
    ).toBe(true);
  });

  it("ロビーは参加操作とホスト設定を分けて表示する", () => {
    const game = makeGame();
    game.phase = "lobby";
    game.analyticsSessionId = "11111111-1111-4111-8111-111111111111";
    const payload = lobbyPayload(game);
    expect(payload.embeds[0].toJSON().title).toBe("人狼ゲーム｜参加受付");
    expect(payload.components).toHaveLength(3);
    const componentJson = JSON.stringify(
      payload.components.map((row) => row.toJSON()),
    );
    expect(componentJson).toContain("参加する");
    expect(componentJson).toContain("退出する");
    expect(componentJson).toContain("配役を設定");
    expect(componentJson).toContain("player-count");
    expect(componentJson).not.toContain("プリセット");
    expect(payload.embeds[0].toJSON().description).not.toContain("｜");
    const playerCountId =
      payload.components[0].toJSON().components[0].custom_id;
    const parsed = parseGameComponentId(playerCountId ?? "");
    expect(parsed).toMatchObject({
      action: "player-count",
      channelId: "channel",
      sessionId: game.analyticsSessionId,
      value: "1",
    });
    expect(hasCurrentGameSession(game, parsed?.sessionId)).toBe(true);
    expect(
      hasCurrentGameSession(
        game,
        parseGameComponentId("tb:player-count:channel:1")?.sessionId,
      ),
    ).toBe(false);
  });

  it("中断時は現在の進行が終了したことを明示する", () => {
    const game = makeGame();
    game.day = 3;
    expect(interruptedGameEmbed(game).toJSON()).toMatchObject({
      title: "ゲーム終了｜中断",
      description: "主催者または管理者が進行中のゲームを終了しました。",
      footer: { text: "3日目で中断" },
    });
  });

  it("再戦準備は終了結果を壊さず、新しいロビー状態を別に作る", () => {
    const game = makeGame(["村人", "人狼", "占い師", "騎士"]);
    game.phase = "ended";
    game.day = 3;
    game.analyticsSessionId = "11111111-1111-4111-8111-111111111111";
    game.analyticsChainId = "22222222-2222-4222-8222-222222222222";
    game.players[0].isNpc = false;
    game.players[0].alive = false;
    game.votes.set("0", "1");

    const rematch = prepareRematchGame(
      game,
      game.analyticsSessionId,
      "33333333-3333-4333-8333-333333333333",
    );

    expect(game.phase).toBe("ended");
    expect(game.day).toBe(3);
    expect(game.players).toHaveLength(4);
    expect(game.votes.size).toBe(1);
    expect(rematch.phase).toBe("lobby");
    expect(rematch.day).toBe(0);
    expect(rematch.players).toHaveLength(1);
    expect(rematch.players[0]).toMatchObject({ alive: true, role: undefined });
    expect(rematch.analyticsSourceSessionId).toBe(game.analyticsSessionId);
    expect(rematch.analyticsSessionId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(rematch.analyticsChainId).toBe(game.analyticsChainId);
    expect(rematch.votes.size).toBe(0);
  });

  it("DM失敗の公開警告から対象者と役職を特定できない", () => {
    const resultWarning = privateDeliveryWarning("result");
    const actionWarning = privateDeliveryWarning("night-action");
    for (const warning of [resultWarning, actionWarning]) {
      expect(warning).not.toContain("<@");
      expect(warning).not.toMatch(/占い師|騎士|霊能者|人狼/);
    }
  });

  it("未変更の標準配役だけを参加人数とプレイ人数へ追従させる", () => {
    const game = makeGame(buildSoloRoles(7));
    game.phase = "lobby";
    game.targetPlayerCount = 7;
    game.players = [
      { id: "host", name: "ホスト", user: null, isNpc: false, alive: true },
      { id: "friend", name: "友達", user: null, isNpc: false, alive: true },
    ];

    expect(syncRecommendedLobbyRoleConfig(game, 7, 1)).toBe(true);
    expect(game.roleConfig).toEqual(recommendedLobbyRoleConfig(7, 2));
    expect(game.roleConfig.人狼).toBe(2);

    game.targetPlayerCount = 11;
    expect(syncRecommendedLobbyRoleConfig(game, 7, 2)).toBe(true);
    expect(game.roleConfig).toEqual(recommendedLobbyRoleConfig(11, 2));

    game.roleConfig = roleConfigFromRoles([
      "人狼",
      "狂人",
      "占い師",
      "騎士",
      "霊能者",
      "村人",
      "村人",
      "村人",
      "村人",
      "村人",
      "村人",
    ]);
    game.targetPlayerCount = 12;
    expect(syncRecommendedLobbyRoleConfig(game, 11, 2)).toBe(false);
    expect(game.roleConfig.狂人).toBe(1);
  });

  it("配役設定は役職選択と増減ボタンを使う", () => {
    const game = makeGame();
    game.phase = "lobby";
    const payload = roleConfigPanel(game);
    expect(payload.embeds[0].toJSON().title).toBe("配役設定｜4人");
    expect(payload.components).toHaveLength(2);
    const componentJson = JSON.stringify(
      payload.components.map((row) => row.toJSON()),
    );
    expect(componentJson).toContain("人狼 1人");
    expect(componentJson).toContain("変更する役職を選ぶ");
    expect(componentJson).toContain("狂人");
    expect(componentJson).toContain("role-increase");
    expect(componentJson).not.toContain("role-config-submit");
    expect(payload.components[1].toJSON().components[2].disabled).toBe(true);
    expect(payload.embeds[0].toJSON().fields?.[0].value).toContain(
      "村人 **1**",
    );

    const betaGame = makeGame();
    betaGame.phase = "lobby";
    betaGame.targetPlayerCount = 5;
    enableBetaHost(betaGame);
    expect(
      roleConfigPanel(betaGame, "占い師").components[1].toJSON().components[2]
        .disabled,
    ).toBe(false);
    expect(roleConfigPanel(betaGame).embeds[0].toJSON().description).toContain(
      "各役職の個別上限はありません",
    );

    const oneWolfGame = makeGame([
      "人狼",
      "占い師",
      "騎士",
      "霊能者",
      "村人",
      "村人",
      "村人",
    ]);
    oneWolfGame.phase = "lobby";
    enableBetaHost(oneWolfGame);
    expect(
      roleConfigPanel(oneWolfGame, "占い師").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);

    const twoWolfGame = makeGame(["人狼", "人狼", "占い師", "村人", "村人"]);
    twoWolfGame.phase = "lobby";
    enableBetaHost(twoWolfGame);
    expect(
      roleConfigPanel(twoWolfGame, "占い師").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);

    const twoSeerGame = makeGame([
      "人狼",
      "人狼",
      "占い師",
      "占い師",
      "村人",
      "村人",
    ]);
    twoSeerGame.phase = "lobby";
    enableBetaHost(twoSeerGame);
    expect(
      roleConfigPanel(twoSeerGame, "占い師").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);

    const threeWolfGame = makeGame([
      "人狼",
      "人狼",
      "人狼",
      "占い師",
      "占い師",
      "村人",
      "村人",
    ]);
    threeWolfGame.phase = "lobby";
    enableBetaHost(threeWolfGame);
    expect(
      roleConfigPanel(threeWolfGame, "占い師").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);

    const maximumSeerGame = makeGame([
      "人狼",
      "人狼",
      "人狼",
      "占い師",
      "占い師",
      "占い師",
      "村人",
    ]);
    maximumSeerGame.phase = "lobby";
    enableBetaHost(maximumSeerGame);
    expect(
      roleConfigPanel(maximumSeerGame, "占い師").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);

    const oneMadmanGame = makeGame([
      "人狼",
      "狂人",
      "占い師",
      "騎士",
      "霊能者",
      "村人",
      "村人",
    ]);
    oneMadmanGame.phase = "lobby";
    enableBetaHost(oneMadmanGame);
    expect(
      roleConfigPanel(oneMadmanGame, "狂人").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);

    const maximumMadmanGame = makeGame([
      "人狼",
      "狂人",
      "狂人",
      "占い師",
      "騎士",
      "霊能者",
      "村人",
    ]);
    maximumMadmanGame.phase = "lobby";
    enableBetaHost(maximumMadmanGame);
    expect(
      roleConfigPanel(maximumMadmanGame, "狂人").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);

    const maximumGuardGame = makeGame([
      "人狼",
      "占い師",
      "騎士",
      "騎士",
      "霊能者",
      "村人",
    ]);
    maximumGuardGame.phase = "lobby";
    expect(
      roleConfigPanel(maximumGuardGame, "騎士").components[1].toJSON()
        .components[2].disabled,
    ).toBe(true);
    enableBetaHost(maximumGuardGame);
    expect(
      roleConfigPanel(maximumGuardGame, "騎士").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);

    const maximumMediumGame = makeGame([
      "人狼",
      "占い師",
      "騎士",
      "霊能者",
      "村人",
      "村人",
    ]);
    maximumMediumGame.phase = "lobby";
    expect(
      roleConfigPanel(maximumMediumGame, "霊能者").components[1].toJSON()
        .components[2].disabled,
    ).toBe(true);
    enableBetaHost(maximumMediumGame);
    expect(
      roleConfigPanel(maximumMediumGame, "霊能者").components[1].toJSON()
        .components[2].disabled,
    ).toBe(false);
  });

  it("複数配役には警告を出さず戦績対象外として判定する", () => {
    const game = makeGame([
      "人狼",
      "人狼",
      "人狼",
      "狂人",
      "狂人",
      "占い師",
      "占い師",
      "占い師",
      "村人",
      "村人",
      "村人",
    ]);
    game.phase = "lobby";
    enableBetaHost(game);
    const panel = roleConfigPanel(game).embeds[0].toJSON();
    expect(panel.fields).toHaveLength(2);
    expect(JSON.stringify(panel)).not.toContain("⚠️");
    expect(usesUnrankedRoleConfig(game)).toBe(true);

    expect(usesUnrankedRoleConfig(makeGame())).toBe(false);
  });

  it("狂人は人狼を知らず、占いと霊能では人間になる", () => {
    const game = makeGame(["狂人", "人狼", "占い師", "村人"]);
    const json = roleDmEmbed(game, game.players[0]).toJSON();
    expect(json.title).toBe("🃏 役職｜狂人");
    expect(json.description).toContain("人狼が誰かは分かりません");
    expect(json.description).not.toContain("仲間の人狼");
    expect(json.fields?.[0].value).toBe("人狼陣営を勝利させる");
    expect(publicResultForRole("狂人")).toBe("人間");
    expect(publicResultForRole("人狼")).toBe("人狼");
  });

  it("プレイヤーの占いCOをNPCの疑いへ反映する", () => {
    const game = makeGame();
    applyPublicClaimSuspicion(game, game.players[1], "人狼");
    expect(game.npcSuspicion.get("1")).toBe(1.25);
    applyPublicClaimSuspicion(game, game.players[1], "人間");
    expect(game.npcSuspicion.get("1")).toBe(0.85);
  });

  it("公開情報による疑いは一人へ積み上がりすぎない", () => {
    const game = makeGame();
    for (let index = 0; index < 5; index += 1) {
      applyPublicClaimSuspicion(game, game.players[1], "人狼");
    }
    expect(game.npcSuspicion.get("1")).toBe(2.5);
  });

  it("直感は弱い意見としてNPCへ伝わる", () => {
    const soloGame = makeGame();
    soloGame.players[1].npcPersonality = "慎重";
    soloGame.humanSuspicions.set("0", {
      targetId: "2",
      reason: "intuition",
    });
    expect(
      npcDecisionSuspicion(soloGame, soloGame.players[1]).get("2"),
    ).toBeCloseTo(0.135);
  });

  it("黒判定と公開意見が重なってもNPCへの共有疑いを急増させない", () => {
    const game = makeGame();
    game.players[1].npcPersonality = "慎重";
    game.humanSuspicions.set("0", {
      targetId: "2",
      reason: "black-result",
    });
    game.npcClaims.push({
      day: 1,
      speakerId: "0",
      claimedRole: "占い師",
      targetId: "2",
      result: "人狼",
    });
    applyPublicClaimSuspicion(game, game.players[2], "人狼");

    expect(npcDecisionSuspicion(game, game.players[1]).get("2")).toBeCloseTo(
      2.025,
    );
  });

  it("占い師COが一人だけなら黒判定を強く投票判断へ反映する", () => {
    const game = makeGame();
    game.players[1].npcPersonality = "慎重";
    game.npcClaims.push({
      day: 1,
      speakerId: "0",
      claimedRole: "占い師",
      targetId: "2",
      result: "人狼",
    });
    applyPublicClaimSuspicion(game, game.players[2], "人狼");

    expect(npcDecisionSuspicion(game, game.players[1]).get("2")).toBeCloseTo(
      1.6875,
    );
  });

  it("初日の単独占いCOは村人陣営NPCが理由なく投票対象にしにくい", () => {
    const game = makeGame(["村人", "村人", "占い師", "人狼"]);
    const observer = game.players[1];
    const claimant = game.players[2];
    observer.npcPersonality = "慎重";
    game.npcClaims.push({
      day: 1,
      speakerId: claimant.id,
      claimedRole: "占い師",
      targetId: game.players[0].id,
      result: "人間",
    });

    const suspicion = npcDecisionSuspicion(game, observer);
    expect(suspicion.get(claimant.id)).toBe(-2.5);
    expect(
      chooseNpcVoteTarget(
        observer,
        game.players.filter((player) => player.id !== observer.id),
        suspicion,
        () => 0.99,
      ),
    ).not.toBe(claimant.id);
  });

  it("人狼陣営NPCには初日の単独占いCO保護を適用しない", () => {
    const game = makeGame(["村人", "村人", "占い師", "人狼"]);
    const claimant = game.players[2];
    const wolf = game.players[3];
    wolf.npcPersonality = "慎重";
    game.npcClaims.push({
      day: 1,
      speakerId: claimant.id,
      claimedRole: "占い師",
      targetId: game.players[0].id,
      result: "人間",
    });

    expect(npcDecisionSuspicion(game, wolf).get(claimant.id)).toBeUndefined();
  });

  it("初日でも破綻した単独占いCOは保護しない", () => {
    const game = makeGame(["村人", "村人", "占い師", "人狼"]);
    const observer = game.players[1];
    const claimant = game.players[2];
    observer.npcPersonality = "追及";
    game.npcClaims.push(
      {
        day: 1,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: game.players[0].id,
        result: "人狼",
      },
      {
        day: 1,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: game.players[1].id,
        result: "人狼",
      },
    );

    expect(npcDecisionSuspicion(game, observer).get(claimant.id)).toBe(0.8);
  });

  it("占い師COが複数なら黒判定へ一人COの信用補正を付けない", () => {
    const game = makeGame();
    game.players[1].npcPersonality = "慎重";
    game.npcClaims.push(
      {
        day: 1,
        speakerId: "0",
        claimedRole: "占い師",
        targetId: "2",
        result: "人狼",
      },
      {
        day: 1,
        speakerId: "3",
        claimedRole: "占い師",
        targetId: "2",
        result: "人間",
      },
    );
    applyPublicClaimSuspicion(game, game.players[2], "人狼");

    expect(npcDecisionSuspicion(game, game.players[1]).get("2")).toBeCloseTo(
      0.5625,
    );
  });

  it("人狼1人の試合が続いたら処刑済み相手への黒判定を破綻扱いする", () => {
    const game = makeGame(["人狼", "村人", "占い師", "騎士", "霊能者"]);
    const claimant = game.players[0];
    const executed = game.players[1];
    const observer = game.players[2];
    observer.npcPersonality = "追及";
    executed.alive = false;
    game.executionHistory.push(executed);
    game.day = 2;
    game.npcClaims.push({
      day: 1,
      speakerId: claimant.id,
      claimedRole: "占い師",
      targetId: executed.id,
      result: "人狼",
    });

    expect(npcDecisionSuspicion(game, observer).get(claimant.id)).toBe(0.8);
  });

  it("プレイヤーが破綻占いを指摘したらNPCも強い根拠として扱う", () => {
    const game = makeGame(["人狼", "村人", "占い師", "騎士", "霊能者"]);
    const claimant = game.players[0];
    const executed = game.players[1];
    const observer = game.players[2];
    observer.npcPersonality = "慎重";
    executed.alive = false;
    game.executionHistory.push(executed);
    game.day = 2;
    game.npcClaims.push({
      day: 1,
      speakerId: claimant.id,
      claimedRole: "占い師",
      targetId: executed.id,
      result: "人狼",
    });
    game.humanSuspicions.set("human", {
      targetId: claimant.id,
      reason: "broken-claim",
    });

    expect(npcDecisionSuspicion(game, observer).get(claimant.id)).toBe(1.8);
  });

  it("公開情報に合わない断言は発言者への疑いになる", () => {
    const game = makeGame();
    const speaker = game.players[0];
    const observer = game.players[1];
    observer.npcPersonality = "追及";
    game.humanSuspicions.set(speaker.id, {
      targetId: game.players[2].id,
      reason: "broken-claim",
    });

    const suspicion = npcDecisionSuspicion(game, observer);
    expect(suspicion.get(speaker.id)).toBeCloseTo(0.96);
    expect(suspicion.get(game.players[2].id)).toBeUndefined();
  });

  it("破綻した一人占いCOの次の黒判定には信用補正を付けない", () => {
    const game = makeGame(["人狼", "村人", "占い師", "騎士", "霊能者"]);
    const claimant = game.players[0];
    const executed = game.players[1];
    const nextTarget = game.players[3];
    const observer = game.players[2];
    observer.npcPersonality = "追及";
    executed.alive = false;
    game.executionHistory.push(executed);
    game.day = 2;
    game.npcClaims.push(
      {
        day: 1,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: executed.id,
        result: "人狼",
      },
      {
        day: 2,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: nextTarget.id,
        result: "人狼",
      },
    );
    applyPublicClaimSuspicion(game, nextTarget, "人狼");

    const suspicion = npcDecisionSuspicion(game, observer);
    expect(suspicion.get(claimant.id)).toBe(0.8);
    expect(suspicion.get(nextTarget.id)).toBeCloseTo(1);
  });

  it("人狼数を超える別々の黒判定も占いCOの破綻として扱う", () => {
    const game = makeGame(["人狼", "村人", "占い師", "騎士", "霊能者"]);
    const claimant = game.players[0];
    const observer = game.players[2];
    observer.npcPersonality = "追及";
    game.day = 2;
    game.npcClaims.push(
      {
        day: 1,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: "1",
        result: "人狼",
      },
      {
        day: 2,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: "3",
        result: "人狼",
      },
    );

    expect(npcDecisionSuspicion(game, observer).get(claimant.id)).toBe(0.8);
  });

  it("NPCは自分で出した占い判定と投票判断を矛盾させない", () => {
    const game = makeGame(["村人", "狂人", "人狼", "村人"]);
    const claimant = game.players[1];
    claimant.npcPersonality = "直感";
    game.npcClaims.push(
      {
        day: 1,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: "2",
        result: "人狼",
      },
      {
        day: 1,
        speakerId: claimant.id,
        claimedRole: "占い師",
        targetId: "3",
        result: "人間",
      },
    );
    applyPublicClaimSuspicion(game, game.players[2], "人狼");
    applyPublicClaimSuspicion(game, game.players[3], "人間");

    const suspicion = npcDecisionSuspicion(game, claimant);
    expect(suspicion.get("2")).toBeGreaterThan(3);
    expect(suspicion.get("3")).toBeLessThan(-3);
  });

  it("プレイヤーの意見と変更を公開メッセージにする", () => {
    const game = makeGame();
    expect(
      humanOpinionLine(game.players[0], game.players[1], "intuition"),
    ).toBe(
      "**とてもとてもとても長いプレイヤー名**（プレイヤー）　👀 **プレイヤー1**を疑う\n根拠：今のところ一番違和感がある",
    );
    expect(
      humanOpinionLine(game.players[0], game.players[2], "black-result", {
        target: game.players[1],
        argument: { targetId: game.players[1].id, reason: "intuition" },
      }),
    ).toBe(
      "**とてもとてもとても長いプレイヤー名**（プレイヤー）　👀 意見変更：**プレイヤー1** → **プレイヤー2**\n根拠：占い師COから人狼判定が出ている",
    );
    expect(
      humanOpinionLine(game.players[0], game.players[1], "counter-claim"),
    ).toContain("根拠：対抗COまたは判定の食い違いが気になる");
  });

  it("NPCへの質問回数と公開メッセージを分かりやすく表示する", () => {
    const game = makeGame();
    expect(remainingNpcQuestions(game, "0")).toBe(2);
    game.npcQuestionCounts.set("0", 1);
    expect(remainingNpcQuestions(game, "0")).toBe(1);
    game.npcQuestionCounts.set("0", 3);
    expect(remainingNpcQuestions(game, "0")).toBe(0);

    expect(
      npcQuestionLine(
        game.players[0],
        game.players[1],
        game.players[2],
        "昨日の投票で2票集まっていた",
      ),
    ).toBe(
      "**とてもとてもとても長いプレイヤー名**（プレイヤー）　❓ **プレイヤー1**に質問\n**プレイヤー1**（NPC）　💬 今は **プレイヤー2** が気になる。昨日の投票で2票集まっていた。",
    );
    expect(
      npcQuestionLine(
        game.players[0],
        game.players[1],
        undefined,
        "生存者を人間と判定している",
      ),
    ).toContain("今は特に疑っている人はいない");
  });

  it("人間の人狼同士で襲撃先が割れたら襲撃を成立させない", () => {
    const game = makeGame(["人狼", "人狼", "占い師", "村人"]);
    game.players[1].isNpc = false;
    expect(
      resolveWolfTarget(
        game.players.slice(0, 2),
        new Map([
          ["kill:0", "2"],
          ["kill:1", "3"],
        ]),
        game.players.slice(2),
      ),
    ).toBeUndefined();
  });

  it("人間とNPCの襲撃先が違う場合は人間の選択を優先する", () => {
    const game = makeGame(["人狼", "人狼", "占い師", "村人"]);
    expect(
      resolveWolfTarget(
        game.players.slice(0, 2),
        new Map([
          ["kill:0", "2"],
          ["kill:1", "3"],
        ]),
        game.players.slice(2),
      ),
    ).toBe("2");
  });

  it("最初に名乗ったCO役職を試合中の役職として扱う", () => {
    const game = makeGame();
    game.npcClaims.push({
      day: 1,
      speakerId: "0",
      claimedRole: "占い師",
      targetId: "1",
      result: "人間",
    });
    game.roleDeclarations.add("1:2:騎士");
    expect(claimedRoleForPlayer(game, "0")).toBe("占い師");
    expect(claimedRoleForPlayer(game, "2")).toBe("騎士");
  });

  it("潜伏した占い師は日数分の過去結果をまとめて公開できる", () => {
    const game = makeGame();
    game.day = 3;
    expect(remainingClaimSlots(game, "0", "占い師")).toBe(3);
    game.npcClaims.push(
      {
        day: 3,
        speakerId: "0",
        claimedRole: "占い師",
        targetId: "1",
        result: "人間",
      },
      {
        day: 3,
        speakerId: "0",
        claimedRole: "占い師",
        targetId: "2",
        result: "人狼",
      },
    );
    expect(remainingClaimSlots(game, "0", "占い師")).toBe(1);
  });

  it("真占いは未公開の実結果だけをすぐCOできる", () => {
    const game = makeGame(["占い師", "人狼", "村人", "村人"]);
    game.day = 2;
    game.seerResults.set("0", [
      { targetId: "1", isWolf: true },
      { targetId: "2", isWolf: false },
    ]);

    expect(
      availableTrueSeerClaims(game, game.players[0]).map(
        ({ day, target, result }) => [day, target.id, result],
      ),
    ).toEqual([
      [1, "1", "人狼"],
      [2, "2", "人間"],
    ]);

    game.npcClaims.push({
      day: 2,
      speakerId: "0",
      claimedRole: "占い師",
      targetId: "1",
      result: "人間",
    });
    expect(
      availableTrueSeerClaims(game, game.players[0]).map(
        ({ day, target, result }) => [day, target.id, result],
      ),
    ).toEqual([[2, "2", "人間"]]);
  });

  it("通常のCO画面は本当の結果をワンタップ公開できる", () => {
    const game = makeGame(["占い師", "人狼", "村人", "村人"]);
    game.day = 2;
    game.seerResults.set("0", [
      { targetId: "1", isWolf: true },
      { targetId: "2", isWolf: false },
    ]);

    const panel = claimPanel(game, game.players[0]);
    const componentJson = JSON.stringify(
      panel.components?.map((row) => row.toJSON()),
    );
    expect(panel.content).toContain("公開する占い結果");
    expect(componentJson).toContain("claim-quick-seer");
    expect(componentJson).toContain("この結果を公開");
    expect(componentJson).toContain("claim-custom-open");
    expect(componentJson).toContain("別の内容でCO");
    expect(componentJson).not.toContain("claim-role");
  });

  it("本当の公開結果がない人は実役職COと騙りを選べる", () => {
    const game = makeGame(["村人", "人狼", "占い師", "村人"]);
    const panel = claimPanel(game, game.players[0]);
    const componentJson = JSON.stringify(
      panel.components?.map((row) => row.toJSON()),
    );

    expect(panel.content).toBe("**村人COしますか？**");
    expect(componentJson).toContain("claim-quick-role-0");
    expect(componentJson).toContain("村人COする");
    expect(componentJson).toContain("claim-custom-open");
    expect(componentJson).not.toContain("claim-day-");
  });

  it("26役職のCO選択をDiscord上限内の2メニューに分ける", () => {
    const rows = claimRoleRows(makeGame());
    const menus = rows.map((row) => row.toJSON().components[0]);
    const options = menus.flatMap((menu) =>
      "options" in menu && menu.options ? menu.options : [],
    );

    expect(rows).toHaveLength(2);
    expect(
      menus.every(
        (menu) => !("options" in menu) || (menu.options?.length ?? 0) <= 25,
      ),
    ).toBe(true);
    expect(options).toHaveLength(26);
    expect(options.map((option) => option.label)).toContain("共有者CO");
    expect(options.map((option) => option.label)).toContain("てるてるCO");
  });

  it("CO済みなら日付選択を挟まず次の判定相手を選べる", () => {
    const game = makeGame(["村人", "人狼", "占い師", "村人"]);
    game.day = 3;
    game.npcClaims.push({
      day: 1,
      resultDay: 1,
      speakerId: "0",
      claimedRole: "占い師",
      targetId: "1",
      result: "人間",
    });
    const panel = claimPanel(game, game.players[0]);
    const componentJson = JSON.stringify(
      panel.components?.map((row) => row.toJSON()),
    );

    expect(panel.content).toContain("占い師CO｜次の結果");
    expect(componentJson).toContain("claim-target-seer-2");
    expect(componentJson).not.toContain("claim-role");
    expect(componentJson).not.toContain("claim-day-");
  });

  it("真霊能も未公開の本当の結果をワンタップ公開できる", () => {
    const game = makeGame(["霊能者", "人狼", "村人", "村人"]);
    game.day = 3;
    game.executionHistory = [game.players[2], game.players[1]];

    expect(
      availableTrueMediumClaims(game, game.players[0]).map(
        ({ day, target, result }) => [day, target.id, result],
      ),
    ).toEqual([
      [1, "2", "人間"],
      [2, "1", "人狼"],
    ]);
    const componentJson = JSON.stringify(
      claimPanel(game, game.players[0]).components?.map((row) => row.toJSON()),
    );
    expect(componentJson).toContain("claim-quick-medium");
    expect(componentJson).toContain("この結果を公開");
  });

  it("真騎士は役職選択なしでCOできる", () => {
    const game = makeGame(["騎士", "人狼", "占い師", "村人"]);
    const componentJson = JSON.stringify(
      claimPanel(game, game.players[0]).components?.map((row) => row.toJSON()),
    );
    expect(componentJson).toContain("claim-quick-role-4");
    expect(componentJson).toContain("騎士COする");
    expect(componentJson).toContain("claim-custom-open");
  });

  it("1日目に偽結果を出しても2日目の真結果を正しく公開候補にする", () => {
    const game = makeGame(["占い師", "村人", "人狼", "村人"]);
    game.day = 2;
    game.seerResults.set("0", [
      { targetId: "1", isWolf: false },
      { targetId: "2", isWolf: true },
    ]);
    game.npcClaims.push({
      day: 1,
      resultDay: 1,
      speakerId: "0",
      claimedRole: "占い師",
      targetId: "3",
      result: "人狼",
    });

    expect(availableClaimDays(game, "0", "占い師")).toEqual([2]);
    expect(hasConflictingSeerClaim(game, "0")).toBe(true);
    expect(
      availableTrueSeerClaims(game, game.players[0]).map(
        ({ day, target, result }) => [day, target.id, result],
      ),
    ).toEqual([[2, "2", "人狼"]]);
  });

  it("COを取り消すと偽結果を無効化して全日の真結果を公開し直せる", () => {
    const game = makeGame(["占い師", "村人", "人狼", "村人"]);
    game.day = 2;
    game.seerResults.set("0", [
      { targetId: "1", isWolf: false },
      { targetId: "2", isWolf: true },
    ]);
    game.npcClaims.push({
      day: 1,
      resultDay: 1,
      speakerId: "0",
      claimedRole: "占い師",
      targetId: "3",
      result: "人狼",
    });
    applyPublicClaimSuspicion(game, game.players[3], "人狼");

    expect(retractPlayerClaim(game, "0")).toBe("占い師");
    expect(game.claimHistory).toContainEqual({
      action: "retract",
      day: 2,
      speakerId: "0",
      claimedRole: "占い師",
    });
    expect(claimedRoleForPlayer(game, "0")).toBeUndefined();
    expect(hasConflictingSeerClaim(game, "0")).toBe(false);
    expect(game.npcSuspicion.has("3")).toBe(false);
    expect(
      availableTrueSeerClaims(game, game.players[0]).map(
        ({ day, target, result }) => [day, target.id, result],
      ),
    ).toEqual([
      [1, "1", "人間"],
      [2, "2", "人狼"],
    ]);
  });

  it("真占いでも別役職を騙った後は実結果の即時COを出さない", () => {
    const game = makeGame(["占い師", "人狼", "村人", "村人"]);
    game.seerResults.set("0", [{ targetId: "1", isWolf: true }]);
    game.npcClaims.push({
      day: 1,
      speakerId: "0",
      claimedRole: "霊能者",
      targetId: "2",
      result: "人間",
    });

    expect(availableTrueSeerClaims(game, game.players[0])).toEqual([]);
  });

  it("投票と夜の最低時間を正確に計算する", () => {
    expect(remainingPhaseMinimumMs(1_000, 10, 4_000)).toBe(7_000);
    expect(remainingPhaseMinimumMs(1_000, 8, 10_000)).toBe(0);
  });

  it("NPCとプレイヤーのCOを同じ一行形式で表示する", () => {
    const game = makeGame();
    expect(
      roleClaimLine(game.players[1], "占い師", game.players[0], "人狼", 1),
    ).toBe(
      "**プレイヤー1**（NPC）　🔮 占い師CO：**1日目**｜**とてもとてもとても長いプレイヤー名** は **人狼**",
    );
    expect(
      roleClaimLine(game.players[0], "霊能者", game.players[1], "人間"),
    ).toContain("（プレイヤー）　👻 霊能者CO");
    expect(roleDeclarationLine(game.players[0], "騎士")).toContain(
      "（プレイヤー）　🛡️ 騎士CO",
    );
    expect(roleDeclarationLine(game.players[0], "共有者")).toContain(
      "（プレイヤー）　🤝 共有者CO",
    );
  });

  it("追加役職のCOを記録・一覧表示・取り消しできる", () => {
    const game = makeGame(["共有者", "共有者", "人狼", "村人"]);
    expect(recordRoleDeclaration(game, game.players[0], "共有者")).toBe(true);
    expect(claimedRoleForPlayer(game, "0")).toBe("共有者");
    expect(JSON.stringify(claimListEmbed(game).toJSON())).toContain("共有者");
    expect(retractPlayerClaim(game, "0")).toBe("共有者");
    expect(claimedRoleForPlayer(game, "0")).toBeUndefined();
  });

  it("CO済みNPCと本物の占い師を翌日も発言者に含める", () => {
    const game = makeGame(["村人", "占い師", "人狼", "狂人", "村人"]);
    game.day = 2;
    game.npcClaims.push({
      day: 1,
      speakerId: "2",
      claimedRole: "占い師",
      targetId: "0",
      result: "人狼",
    });

    const speakerIds = npcDiscussionSpeakers(game, 1).map(
      (speaker) => speaker.id,
    );
    expect(speakerIds).toContain("1");
    expect(speakerIds).toContain("2");
  });

  it("公開情報型の追加役職NPCは適切な日からCO候補になる", () => {
    const game = makeGame(["人狼", "共有者", "共有者", "パン屋", "市長"]);
    expect(npcPublicRoleClaim(game, game.players[1])).toBe("共有者");
    expect(npcPublicRoleClaim(game, game.players[3])).toBe("パン屋");
    expect(npcPublicRoleClaim(game, game.players[4])).toBeUndefined();
    game.day = 2;
    expect(npcPublicRoleClaim(game, game.players[4])).toBe("市長");
  });

  it("自由配役ではCO対象を全員通し、通常発言者だけ指定人数に抑える", () => {
    const game = makeGame([
      "村人",
      "占い師",
      "占い師",
      "占い師",
      "占い師",
      "村人",
      "村人",
    ]);
    const speakerIds = npcDiscussionSpeakers(game, 1).map(
      (speaker) => speaker.id,
    );
    expect(speakerIds).toHaveLength(5);
    expect(speakerIds).toEqual(expect.arrayContaining(["1", "2", "3", "4"]));
    expect(speakerIds.filter((id) => id === "5" || id === "6")).toHaveLength(1);
  });

  it("2日目に潜伏解除するNPCを必ず発言者に含める", () => {
    const game = makeGame(["村人", "人狼", "狂人", "村人"]);
    game.day = 2;
    game.npcSeerClaimPlans.set("1", "day2");

    const speakerIds = npcDiscussionSpeakers(game, 1).map(
      (speaker) => speaker.id,
    );
    expect(speakerIds).toContain("1");
  });

  it("2日目に潜伏解除したNPCは1日目と2日目の結果をまとめて公開する", () => {
    const game = makeGame(["村人", "人狼", "狂人", "村人"]);
    game.day = 2;

    expect(npcFakeSeerClaimDays(game, "1", false)).toEqual([1, 2]);

    game.npcClaims.push({
      day: 2,
      resultDay: 1,
      speakerId: "1",
      claimedRole: "占い師",
      targetId: "0",
      result: "人間",
    });
    expect(npcFakeSeerClaimDays(game, "1", true)).toEqual([2]);
  });

  it("NPC占い師は未占いの生存者を優先する", () => {
    const game = makeGame();
    game.seerResults.set("1", [
      { targetId: "0", isWolf: true },
      { targetId: "2", isWolf: false },
    ]);
    expect(nextNpcSeerTarget(game, game.players[1])?.id).toBe("3");
  });

  it("真占いが夜に操作しなければ未占いの相手を自動で占う", () => {
    const game = makeGame(["占い師", "人狼", "村人", "村人"]);
    game.phase = "night";
    game.players[0].isNpc = false;
    game.seerResults.set("0", [{ targetId: "2", isWolf: false }]);

    const notice = autoSelectHumanSeer(game, game.players[0]);
    const selectedId = game.nightChoices.get("seer:0");
    expect(selectedId).toBeDefined();
    expect(selectedId).not.toBe("0");
    expect(selectedId).not.toBe("2");
    expect(notice).toContain("自動選択");
    expect(game.seerResults.get("0")).toHaveLength(2);
    expect(autoSelectHumanSeer(game, game.players[0])).toBeUndefined();
    expect(game.seerResults.get("0")).toHaveLength(2);
  });

  it("全員を占い済みでも再占いした日の結果と日付を欠落させない", () => {
    const game = makeGame(["占い師", "人狼"]);
    game.phase = "night";
    game.day = 2;
    game.seerResults.set("0", [{ targetId: "1", isWolf: true }]);

    fillMissingNightAction(game, game.players[0], "seer");

    expect(game.seerResults.get("0")).toEqual([
      { targetId: "1", isWolf: true },
      { targetId: "1", isWolf: true },
    ]);
    expect(
      availableTrueSeerClaims(game, game.players[0]).map(
        ({ day, target, result }) => [day, target.id, result],
      ),
    ).toEqual([
      [1, "1", "人狼"],
      [2, "1", "人狼"],
    ]);

    game.phase = "day";
    for (const claim of availableTrueSeerClaims(game, game.players[0])) {
      expect(
        recordRoleClaim(
          game,
          game.players[0],
          "占い師",
          claim.target,
          claim.result,
          claim.day,
        ),
      ).toBe(true);
    }
    expect(
      game.npcClaims.map((claim) => [claim.resultDay, claim.targetId]),
    ).toEqual([
      [1, "1"],
      [2, "1"],
    ]);
  });

  it("占い師が2人いても、それぞれ別に夜行動と結果を持てる", () => {
    const game = makeGame(["占い師", "占い師", "人狼", "村人", "村人"]);
    game.phase = "night";
    game.players[0].isNpc = false;
    game.players[1].isNpc = false;

    expect(autoSelectHumanSeer(game, game.players[0])).toContain("自動選択");
    expect(autoSelectHumanSeer(game, game.players[1])).toContain("自動選択");

    expect(game.nightChoices.get("seer:0")).toBeDefined();
    expect(game.nightChoices.get("seer:1")).toBeDefined();
    expect(game.seerResults.get("0")).toHaveLength(1);
    expect(game.seerResults.get("1")).toHaveLength(1);
  });

  it("騎士は前夜と同じ相手も続けて護衛できる", () => {
    const game = makeGame(["騎士", "村人", "人狼", "占い師"]);
    game.phase = "night";
    game.players[2].alive = false;
    game.players[3].alive = false;
    (game as GameState & { lastGuardedId?: string }).lastGuardedId = "1";

    fillMissingNightAction(game, game.players[0], "guard");

    expect(game.nightChoices.get("guard:0")).toBe("1");
  });

  it("騎士が2人いる場合は、それぞれの護衛を有効にする", () => {
    const game = makeGame(["騎士", "騎士", "人狼", "村人", "占い師"]);
    game.phase = "night";
    game.nightChoices.set("guard:0", "3");
    game.nightChoices.set("guard:1", "4");

    expect(isTargetGuarded(game, "3")).toBe(true);
    expect(isTargetGuarded(game, "4")).toBe(true);
    expect(isTargetGuarded(game, "2")).toBe(false);

    game.players[0].alive = false;
    expect(isTargetGuarded(game, "3")).toBe(false);
    expect(isTargetGuarded(game, "4")).toBe(true);
  });

  it("騎士が5人いても全員の護衛を判定する", () => {
    const game = makeGame([
      "騎士",
      "騎士",
      "騎士",
      "騎士",
      "騎士",
      "人狼",
      "村人",
      "占い師",
    ]);
    game.phase = "night";
    game.nightChoices.set("guard:0", "6");
    game.nightChoices.set("guard:1", "7");
    game.nightChoices.set("guard:2", "6");
    game.nightChoices.set("guard:3", "7");
    game.nightChoices.set("guard:4", "6");

    expect(isTargetGuarded(game, "6")).toBe(true);
    expect(isTargetGuarded(game, "7")).toBe(true);
    game.players[0].alive = false;
    game.players[2].alive = false;
    game.players[4].alive = false;
    expect(isTargetGuarded(game, "6")).toBe(false);
    expect(isTargetGuarded(game, "7")).toBe(true);
  });

  it("生存中の人間の霊能者全員を結果送信対象にする", () => {
    const game = makeGame(["霊能者", "霊能者", "人狼", "霊能者", "村人"]);
    game.players[1].isNpc = false;
    game.players[3].isNpc = false;
    game.players[3].alive = false;

    expect(mediumResultRecipients(game).map((player) => player.id)).toEqual([
      "0",
      "1",
    ]);
  });

  it("複数の人間霊能者全員へ同じ霊能結果を送る", async () => {
    const game = makeGame(["霊能者", "霊能者", "人狼", "村人"]);
    const firstSend = vi.fn().mockResolvedValue({});
    const secondSend = vi.fn().mockResolvedValue({});
    game.players[0].user = { send: firstSend } as unknown as Player["user"];
    game.players[1].isNpc = false;
    game.players[1].user = { send: secondSend } as unknown as Player["user"];
    game.lastExecuted = game.players[2];

    await sendMediumResults(game);

    expect(firstSend).toHaveBeenCalledOnce();
    expect(secondSend).toHaveBeenCalledOnce();
    expect(JSON.stringify(firstSend.mock.calls[0][0])).toContain("人狼");
    expect(JSON.stringify(secondSend.mock.calls[0][0])).toContain("人狼");
  });

  it("公開済みのCOと判定を役職ごとに整理する", () => {
    const game = makeGame();
    game.day = 2;
    game.npcClaims = [
      {
        day: 2,
        resultDay: 1,
        speakerId: "1",
        claimedRole: "占い師",
        targetId: "0",
        result: "人間",
      },
      {
        day: 2,
        resultDay: 2,
        speakerId: "1",
        claimedRole: "占い師",
        targetId: "2",
        result: "人狼",
      },
      {
        day: 2,
        speakerId: "0",
        claimedRole: "霊能者",
        targetId: "3",
        result: "人間",
      },
    ];
    game.roleDeclarations.add("2:0:騎士");

    const json = claimListEmbed(game).toJSON();
    expect(json.title).toBe("CO・判定一覧｜2日目");
    expect(json.description).toContain("本物とは限りません");
    expect(json.fields?.[0].value).toContain(
      "**プレイヤー1**（NPC）　1日目 **とてもとてもとても長いプレイヤー名** ○｜2日目 **プレイヤー2** ●",
    );
    expect(json.fields?.[1].value).toContain(
      "**とてもとてもとても長いプレイヤー名**（プレイヤー）",
    );
    expect(json.fields?.[2].value).toContain("2日目");
    expect(json.footer?.text).toBe("● 人狼判定　○ 人間判定（各欄は直近30件）");
  });

  it("COがない役職も空欄だと明示する", () => {
    const json = claimListEmbed(makeGame()).toJSON();
    expect(json.fields?.map((field) => field.value)).toEqual(["—", "—", "—"]);
  });

  it("占い師3人までは正常枠として表示し、一致判定を示す", () => {
    const game = makeGame([
      "人狼",
      "人狼",
      "人狼",
      "占い師",
      "占い師",
      "占い師",
      "村人",
    ]);
    game.npcClaims.push(
      {
        day: 1,
        speakerId: "3",
        claimedRole: "占い師",
        targetId: "0",
        result: "人狼",
      },
      {
        day: 1,
        speakerId: "4",
        claimedRole: "占い師",
        targetId: "0",
        result: "人狼",
      },
      {
        day: 1,
        speakerId: "5",
        claimedRole: "占い師",
        targetId: "0",
        result: "人狼",
      },
    );

    expect(claimListEmbed(game).toJSON().fields?.[0].name).toBe(
      "🔮 占い師CO｜3/3人・一致判定あり",
    );
  });

  it("占い判定の白黒割れと配役を超えたCOを区別して表示する", () => {
    const game = makeGame([
      "人狼",
      "人狼",
      "人狼",
      "占い師",
      "占い師",
      "占い師",
      "村人",
      "村人",
    ]);
    game.npcClaims.push(
      {
        day: 1,
        speakerId: "3",
        claimedRole: "占い師",
        targetId: "0",
        result: "人狼",
      },
      {
        day: 1,
        speakerId: "4",
        claimedRole: "占い師",
        targetId: "0",
        result: "人間",
      },
      {
        day: 1,
        speakerId: "5",
        claimedRole: "占い師",
        targetId: "1",
        result: "人間",
      },
    );
    expect(claimListEmbed(game).toJSON().fields?.[0].name).toContain(
      "3/3人・判定割れ",
    );

    game.npcClaims.push({
      day: 1,
      speakerId: "6",
      claimedRole: "占い師",
      targetId: "1",
      result: "人間",
    });
    expect(claimListEmbed(game).toJSON().fields?.[0].name).toContain(
      "4/3人・配役超過・判定割れ",
    );
  });

  it("投票者・投票先・得票数を公開履歴として残す", () => {
    const game = makeGame();
    game.players[1].npcPersonality = "同調";
    game.players[2].npcPersonality = "同調";
    game.votes.set("0", "1");
    game.votes.set("1", "0");
    game.votes.set("2", "1");
    recordCurrentVoteRound(game);

    expect(game.voteHistory[0]).toMatchObject({ day: 1, round: 1 });
    expect(voteTallyRows(game)).toContain("プレイヤー1：2票");
    expect(voteBallotFields(game)[0].value).toContain(
      "👤 とてもとてもとても長いプレイヤー名 → 🤖 プレイヤー1",
    );
    expect(game.npcMemory.get("1")?.get("0")).toBe(0.5);
    expect(game.npcMemory.get("2")?.get("1")).toBeCloseTo(0.9);
  });

  it("分断中の議論画面には同じ部屋の参加者だけを表示する", () => {
    const game = makeGame(["分断者", "人狼", "占い師", "村人"]);
    game.divisionGroups = new Map([
      ["0", "A"],
      ["1", "A"],
      ["2", "B"],
      ["3", "B"],
    ]);

    const json = dayEmbed(game, "A").toJSON();
    expect(json.fields?.[0].name).toBe("A組（2人）");
    expect(json.fields?.[0].value).toContain("プレイヤー1");
    expect(json.fields?.[0].value).not.toContain("プレイヤー2");
  });

  it("分断者と指定相手を同じ部屋に置き、人数を均等に分ける", () => {
    const game = makeGame(["分断者", "人狼", "占い師", "騎士", "村人"]);
    const groups = divisionGroupsForPlayers(game.players, "0", "3");

    expect(groups.get("0")).toBe(groups.get("3"));
    expect([...groups.values()].filter((group) => group === "A")).toHaveLength(
      3,
    );
    expect([...groups.values()].filter((group) => group === "B")).toHaveLength(
      2,
    );
  });

  it("再起動後に分断前のチャンネル権限を復旧できる情報を解析する", () => {
    const snapshot = divisionRecoverySnapshotFromTopic(
      "jinrobot-division:v1:123456789012345678:123456789012345678.d,234567890123456789.i,345678901234567890.a",
    );

    expect(snapshot?.mainChannelId).toBe("123456789012345678");
    expect([...(snapshot?.permissions.entries() ?? [])]).toEqual([
      ["123456789012345678", "deny"],
      ["234567890123456789", "inherit"],
      ["345678901234567890", "allow"],
    ]);
    expect(divisionRecoverySnapshotFromTopic("unrelated")).toBeUndefined();
  });

  it("市長の投票を2票として集計する", () => {
    const game = makeGame(["市長", "人狼", "占い師", "村人"]);
    game.votes.set("0", "1");
    game.votes.set("1", "0");
    expect(weightedVoteTargetIds(game)).toEqual(["1", "1", "0"]);
    expect(voteTallyRows(game)).toContain("プレイヤー1：2票");
    expect(voteBallotFields(game)[0].value).toContain("（2票）");
  });

  it("追加役職の夜行動を役職と日数に応じて割り当てる", () => {
    const always: Array<[RoleName, string]> = [
      ["饒舌な人狼", "kill"],
      ["逃亡者", "flee"],
      ["暗殺者", "assassinate"],
      ["妖術師", "sorcery"],
      ["分断者", "divide"],
    ];
    for (const [role, action] of always) {
      const game = makeGame([role, "人狼", "占い師", "村人"]);
      expect(nightActionForPlayer(game, game.players[0])).toBe(action);
    }

    const firstNightRoles: Array<[RoleName, string]> = [
      ["キューピッド", "cupid"],
      ["純愛者", "devotee"],
      ["怪盗", "thief"],
    ];
    for (const [role, action] of firstNightRoles) {
      const game = makeGame([role, "人狼", "占い師", "村人"]);
      expect(nightActionForPlayer(game, game.players[0])).toBe(action);
      game.day = 2;
      expect(nightActionForPlayer(game, game.players[0])).toBeUndefined();
    }

    const compassGame = makeGame(["方位磁針", "人狼", "占い師", "村人"]);
    expect(
      nightActionForPlayer(compassGame, compassGame.players[0]),
    ).toBeUndefined();
    compassGame.day = 2;
    expect(nightActionForPlayer(compassGame, compassGame.players[0])).toBe(
      "compass",
    );
  });

  it("NPC暗殺者は公開上の疑いが強い相手を優先して使う", () => {
    const game = makeGame(["暗殺者", "人狼", "占い師", "村人"]);
    const assassin = game.players[0];
    assassin.isNpc = true;
    assassin.npcPersonality = "追及";
    game.day = 2;
    game.npcSuspicion.set(game.players[1].id, 2.5);

    expect(
      chooseNpcAssassinationTarget(
        game,
        assassin,
        game.players.slice(1),
        () => 0,
      )?.id,
    ).toBe(game.players[1].id);
  });

  it("NPC暗殺者は根拠が薄ければ能力を見送れる", () => {
    const game = makeGame(["暗殺者", "人狼", "占い師", "村人"]);
    const assassin = game.players[0];
    assassin.isNpc = true;
    assassin.npcPersonality = "慎重";
    game.day = 2;

    expect(
      chooseNpcAssassinationTarget(
        game,
        assassin,
        game.players.slice(1),
        () => 0.99,
      ),
    ).toBeUndefined();
  });

  it("饒舌な人狼は実際の議論メッセージにお題を含めると達成する", () => {
    const game = makeGame(["饒舌な人狼", "占い師", "騎士", "村人"]);
    game.loquaciousMissions = new Map([["0", "投票"]]);
    game.loquaciousCompleted = new Set();

    expect(
      completeLoquaciousMissionForMessage(
        game,
        "0",
        game.channelId,
        "占い結果を見よう",
      ),
    ).toBeUndefined();
    expect(
      completeLoquaciousMissionForMessage(
        game,
        "0",
        game.channelId,
        "今日は投票先を考えよう",
      ),
    ).toBe("投票");
    expect(
      completeLoquaciousMissionForMessage(game, "0", game.channelId, "投票"),
    ).toBeUndefined();
  });

  it("分断中の饒舌ミッションは本人の分断部屋での発言だけを数える", () => {
    const game = makeGame(["饒舌な人狼", "占い師", "騎士", "村人"]);
    game.loquaciousMissions = new Map([["0", "理由"]]);
    game.loquaciousCompleted = new Set();
    game.divisionGroups = new Map([["0", "A"]]);
    game.divisionChannels = new Map([["A", { id: "sector-a" } as TextChannel]]);

    expect(
      completeLoquaciousMissionForMessage(
        game,
        "0",
        game.channelId,
        "理由を話す",
      ),
    ).toBeUndefined();
    expect(
      completeLoquaciousMissionForMessage(game, "0", "sector-a", "理由を話す"),
    ).toBe("理由");
  });

  it("恋人の片方が死亡するともう片方も道連れになる", () => {
    const game = makeGame(["村人", "人狼", "占い師", "村人"]);
    game.loverPairs = [["0", "2"]];
    const deaths: Player[] = [];
    eliminateWithLovers(game, game.players[0], deaths);
    expect(deaths.map((player) => player.id)).toEqual(["0", "2"]);
    expect(game.players[2].alive).toBe(false);
  });

  it("共有者と狂信者のDMには知っている仲間を表示する", () => {
    const shared = makeGame(["共有者", "共有者", "人狼", "村人"]);
    expect(
      roleDmEmbed(shared, shared.players[0]).toJSON().description,
    ).toContain("共有者の相方: プレイヤー1");

    const fanatic = makeGame(["狂信者", "饒舌な人狼", "人狼", "村人"]);
    const description = roleDmEmbed(fanatic, fanatic.players[0]).toJSON()
      .description;
    expect(description).toContain("人狼: プレイヤー1、プレイヤー2");
  });

  it("人狼会議は生存中の人間の人狼だけを仲間として扱う", () => {
    const game = makeGame(["人狼", "人狼", "人狼", "村人"]);
    game.players[1].isNpc = false;

    expect(livingHumanWolfAllies(game, "0").map((player) => player.id)).toEqual(
      ["1"],
    );
    game.players[1].alive = false;
    expect(livingHumanWolfAllies(game, "0")).toEqual([]);
  });

  it("人間の人狼が複数いる夜だけ人狼会議ボタンを表示する", () => {
    const game = makeGame(["人狼", "人狼", "村人", "村人"]);
    game.phase = "night";
    game.day = 2;
    game.players[1].isNpc = false;

    const row = wolfChatButtonRow(game, game.players[0]);
    expect(JSON.stringify(row?.toJSON())).toContain(
      "tb:wolf-chat-open:channel:",
    );
    expect(JSON.stringify(row?.toJSON())).toContain(":2");
    game.players[1].isNpc = true;
    expect(wolfChatButtonRow(game, game.players[0])).toBeUndefined();
  });

  it("人狼会議の送信は一人につき一夜2回までにする", () => {
    const game = makeGame(["人狼", "人狼", "村人", "村人"]);
    expect(remainingWolfChatMessages(game, "0")).toBe(2);
    game.wolfChatCounts.set("0", 1);
    expect(remainingWolfChatMessages(game, "0")).toBe(1);
    game.wolfChatCounts.set("0", 2);
    expect(remainingWolfChatMessages(game, "0")).toBe(0);
    game.wolfChatCounts.set("0", 99);
    expect(remainingWolfChatMessages(game, "0")).toBe(0);
  });

  it("人狼会議はメンションを無効化してDM用メッセージを作る", () => {
    const game = makeGame(["人狼", "人狼", "村人", "村人"]);
    game.day = 3;
    const payload = wolfChatRelayPayload(
      game,
      game.players[0],
      "@everyone **アカネを襲撃**",
    );
    expect(payload.allowedMentions.parse).toEqual([]);
    const embed = payload.embeds?.[0];
    expect(JSON.stringify(embed)).toContain("人狼会議｜3日目");
    expect(JSON.stringify(embed)).toContain("アカネを襲撃");
  });

  it("終了画面から再戦・感想戦・問題報告を選べる", () => {
    const game = makeGame();
    game.phase = "ended";
    game.analyticsSessionId = "recap-session";

    const json = JSON.stringify(gameResultRow(game).toJSON());
    expect(json).toContain("もう一度遊ぶ");
    expect(json).toContain("試合を振り返る");
    expect(json).toContain("気になる点を送る");
    expect(json).toContain("tb:recap:channel:recap-session");
  });

  it("感想戦でCO・投票・夜行動と実際の役職を日別表示する", () => {
    const game = makeGame(["村人", "狂人", "占い師", "騎士", "人狼"]);
    game.phase = "ended";
    game.day = 2;
    game.claimHistory.push(
      {
        action: "claim",
        day: 1,
        resultDay: 1,
        speakerId: "1",
        claimedRole: "占い師",
        targetId: "4",
        result: "人間",
      },
      {
        action: "claim",
        day: 1,
        resultDay: 1,
        speakerId: "2",
        claimedRole: "占い師",
        targetId: "4",
        result: "人狼",
      },
      {
        action: "claim",
        day: 1,
        speakerId: "3",
        claimedRole: "騎士",
      },
    );
    game.voteHistory.push({
      day: 1,
      round: 1,
      ballots: [
        { voterId: "0", targetId: "1" },
        { voterId: "1", targetId: "0" },
        { voterId: "2", targetId: "1" },
        { voterId: "3", targetId: "1" },
        { voterId: "4", targetId: "0" },
      ],
    });
    game.seerResults.set("2", [{ targetId: "4", isWolf: true }]);
    game.nightChoices.set("kill:4", "0");
    game.nightChoices.set("guard:3", "0");
    game.nightChoices.set("seer:2", "4");
    recordNightHistory(game, "0", true);

    const json = JSON.stringify(
      postgameRecapEmbeds(game).map((embed) => embed.toJSON()),
    );
    expect(json).toContain("感想戦｜役職の真相");
    expect(json).toContain("占い師CO（実際：狂人）");
    expect(json).toContain("人間（実際：人狼）");
    expect(json).toContain("プレイヤー2** → **プレイヤー1");
    expect(json).toContain("への護衛成功");
    expect(json).toContain("本当の占い結果");
  });

  it("15人・20日分の感想戦もDiscordの表示上限内に分割する", () => {
    const roles: RoleName[] = [
      "人狼",
      "人狼",
      "狂人",
      "占い師",
      "占い師",
      "騎士",
      "騎士",
      "霊能者",
      "村人",
      "村人",
      "村人",
      "村人",
      "村人",
      "村人",
      "村人",
    ];
    const game = makeGame(roles);
    game.phase = "ended";
    game.day = 20;
    game.players.forEach((player, index) => {
      player.name = `${index}とても長いプレイヤー名`.padEnd(32, "名");
    });
    for (let day = 1; day <= 20; day += 1) {
      for (const player of game.players) {
        game.claimHistory.push({
          action: "claim",
          day,
          resultDay: day,
          speakerId: player.id,
          claimedRole: "占い師",
          targetId: String((Number(player.id) + 1) % game.players.length),
          result: day % 2 === 0 ? "人狼" : "人間",
        });
      }
      for (const round of [1, 2])
        game.voteHistory.push({
          day,
          round,
          ballots: game.players.map((player) => ({
            voterId: player.id,
            targetId: String((Number(player.id) + round) % game.players.length),
          })),
        });
    }

    const embeds = postgameRecapEmbeds(game);
    const batches = postgameRecapBatches(embeds);
    expect(batches.every((batch) => batch.length <= 10)).toBe(true);
    for (const embed of embeds) {
      const json = embed.toJSON();
      expect(json.fields?.length ?? 0).toBeLessThanOrEqual(25);
      expect(
        (json.fields ?? []).every((field) => field.value.length <= 1_024),
      ).toBe(true);
    }
    for (const batch of batches) {
      const characters = batch.reduce((total, embed) => {
        const json = embed.toJSON();
        return (
          total +
          (json.title?.length ?? 0) +
          (json.description?.length ?? 0) +
          (json.fields ?? []).reduce(
            (sum, field) => sum + field.name.length + field.value.length,
            0,
          )
        );
      }, 0);
      expect(characters).toBeLessThanOrEqual(6_000);
    }
  });
});
