// src/npcLogic.ts

import { GameState, Player } from "./types";
// NAPI-RSで生成したRustの計算エンジンをインポート！
import { calculateNpcVote } from "../tomatobot-core";

export function getNpcVoteTarget(npc: any, game: GameState): { targetId: string, reasonType: string } | string {
    
    // 1. Rustに渡すためのデータ整形（バケツリレーの荷造り）
    const rustPlayers = game.players.map(p => ({
        id: p.id,
        alive: p.alive ?? false,
        role: p.role ?? "村人",
        personality: p.personality ?? "normal"
    }));

    const rustEvidence = game.evidence.map(e => ({
        type: e.type,
        from: e.from,
        target: e.target,
        result: e.result === true,
        visible: e.visible ?? false
    }));

    // ループの中で計算すると重い「チャット回数」は、ここでサクッと数えてRustに渡す
    const chatCounts: Record<string, number> = {};
    game.players.forEach(p => {
        chatCounts[p.id] = game.chatLog.filter((l: any) => (l.id && l.id === p.id) || l.name === p.name).length;
    });

    const voteLogs = game.voteLog.map((log: any) => ({ votes: log.votes }));

    const rustGameState = {
        players: rustPlayers,
        evidence: rustEvidence,
        lovers: game.lovers || [],
        dayCount: game.dayCount,
        isPublicVote: game.settings.voteTransparency === 'public',
        chatCounts: chatCounts,
        voteLogs: voteLogs
    };

    const rustNpc = rustPlayers.find(p => p.id === npc.id)!;
    
    // Rust側での面倒な乱数設定を省くため、TypeScript側で乱数の配列を作って投げるハック
    const randValues = Array.from({ length: game.players.length }, () => Math.random());

    // 2. いざ、Rustエンジンで爆速計算！！
    const result = calculateNpcVote(rustNpc, rustGameState, randValues);

    if (result.targetId === "skip") return "skip";
    return { targetId: result.targetId, reasonType: result.reasonType };
}

// ⚠️ detectLiars 関数はRust内部に完全に吸収されたので、TypeScript側からは削除しました！
