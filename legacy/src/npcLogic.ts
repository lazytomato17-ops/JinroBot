// src/npcLogic.ts
import { GameState, Player } from "./types";
import { isWolfTeam } from "./roles";

// ==========================================
// 性格ごとの重み付けパラメーター (RustのTraitsを移植)
// ==========================================
interface Traits {
    silence: number;    // 無口な人を疑う度合い
    gray: number;       // グレー（役職なし）を吊る度合い
    liar: number;       // 嘘つき（破綻者）を許さない度合い
    roller: number;     // 役職CO者をローラー（順番吊り）する度合い
    protect: number;    // 役職者や白確を守る度合い
    logical: number;    // 投票ログやライン考察を重視する度合い
    random: number;     // 気分（乱数）でブレる度合い
    aggressive: number; // 私怨（自分に投票した奴）への攻撃性
}

function getTraits(personality: string): Traits {
    switch (personality) {
        case 'aggressive': return { silence: 3.0, gray: 1.5, liar: 1.0, roller: 1.0, protect: 0.5, logical: 0.5, random: 10.0, aggressive: 2.0 };
        case 'cautious':   return { silence: 0.5, gray: 0.5, liar: 1.0, roller: 0.2, protect: 2.0, logical: 1.0, random: 5.0,  aggressive: 0.5 };
        case 'logical':    return { silence: 1.0, gray: 1.0, liar: 2.0, roller: 2.0, protect: 1.0, logical: 2.0, random: 0.0,  aggressive: 1.0 };
        case 'joker':      return { silence: 0.0, gray: 0.5, liar: 0.5, roller: 0.0, protect: 0.0, logical: 0.0, random: 40.0, aggressive: 1.5 };
        case 'serious':    return { silence: 1.2, gray: 1.2, liar: 1.5, roller: 1.2, protect: 1.5, logical: 1.5, random: 5.0,  aggressive: 1.0 };
        case 'witty':      return { silence: 0.8, gray: 1.0, liar: 1.2, roller: 1.0, protect: 1.0, logical: 1.5, random: 10.0, aggressive: 1.0 };
        // 💀 sans: 攻撃性が極めて低いが、嘘やローラーには論理的に対応する
        case 'sans':       return { silence: 2.0, gray: 0.5, liar: 1.5, roller: 1.5, protect: 0.5, logical: 1.5, random: 5.0,  aggressive: 0.2 };
        case 'jax':        return { silence: 0.0, gray: 1.5, liar: 1.0, roller: 1.0, protect: 0.0, logical: 0.5, random: 30.0, aggressive: 2.0 };
        case 'ninja':      return { silence: 0.0, gray: 1.5, liar: 2.5, roller: 0.5, protect: 2.0, logical: 0.5, random: 20.0, aggressive: 1.5 };
        case 'chuuni':     return { silence: 0.5, gray: 1.0, liar: 1.0, roller: 1.0, protect: 0.5, logical: 0.0, random: 40.0, aggressive: 1.0 };
        case 'dio':        return { silence: 1.5, gray: 1.0, liar: 2.0, roller: 1.5, protect: 0.0, logical: 1.0, random: 25.0, aggressive: 3.5 };
        default:           return { silence: 1.0, gray: 1.0, liar: 1.0, roller: 1.0, protect: 1.0, logical: 1.0, random: 10.0, aggressive: 1.0 };
    }
}

export function getNpcVoteTarget(npc: Player, game: GameState): { targetId: string, reasonType: string } | string {
    let traitVals = getTraits(npc.personality || 'normal');
    if (npc.role === 'テルテル') traitVals.random = 100.0;

    const alivePlayers = game.players.filter(p => p.alive);
    const others = alivePlayers.filter(p => p.id !== npc.id);

    // 🌟 絶対優先ロジック: 自分が黒出しした相手が生きているなら、絶対にそいつに投票する
    for (const e of game.evidence) {
        if (e.from === npc.id && (e.type === 'divine' || e.type === 'medium_co') && e.result === true) {
            if (others.some(p => p.id === e.target)) {
                return { targetId: e.target, reasonType: "black" };
            }
        }
    }

    let scores: Record<string, number> = {};
    let reasons: Record<string, string> = {};
    for (const p of others) {
        scores[p.id] = 0.0;
        reasons[p.id] = "gray";
    }

    // ==========================================
    // 1. 破綻者（嘘つき）の検出
    // ==========================================
    const liars = new Set<string>();
    
    // 検死官NPCの場合、死者の本当の役職を知っているため、嘘の占い結果を見抜ける
    if (npc.role === '検死官') {
        const deadPlayers = game.players.filter(p => !p.alive);
        for (const dead of deadPlayers) {
            const isWolf = dead.role === '人狼';
            for (const e of game.evidence) {
                if (e.visible && e.type === 'divine' && e.target === dead.id && e.result !== isWolf) {
                    liars.add(e.from);
                }
            }
        }
    }
    
    // 自分が人間陣営なら、自分に黒を出してきた奴は嘘つき確定
    if (!['人狼', '狂人', '狂信者', '妖術師'].includes(npc.role as string)) {
        for (const e of game.evidence) {
            if (e.visible && e.type === 'divine' && e.target === npc.id && e.result === true) {
                liars.add(e.from);
            }
        }
    }

    // 占い師と霊能者の結果の矛盾
    for (const med of game.evidence) {
        if (med.visible && med.type === 'medium_co') {
            for (const seer of game.evidence) {
                if (seer.visible && seer.type === 'divine' && seer.target === med.target) {
                    if (seer.result !== med.result) {
                        liars.add(seer.from);
                        liars.add(med.from);
                    }
                }
            }
        }
    }

    // 嘘つきへの超高スコア加算
    for (const liarId of Array.from(liars)) {
        if (scores[liarId] !== undefined) {
            scores[liarId] += 500.0 * traitVals.liar;
            const isSelfHatan = game.evidence.some(e => e.from === liarId && e.target === npc.id && e.result === true);
            if (npc.role === '検死官') reasons[liarId] = "coroner_truth";
            else if (isSelfHatan) reasons[liarId] = "self_破綻";
            else reasons[liarId] = "liar";
        }
    }

    // ==========================================
    // 2. CO状況と確定白黒の収集
    // ==========================================
    const validSeers = new Set<string>();
    const confirmedWhites = new Set<string>();
    const confirmedBlacks = new Set<string>();

    for (const e of game.evidence) {
        if (e.visible && e.type === 'divine' && !liars.has(e.from)) {
            const seer = game.players.find(p => p.id === e.from);
            if (seer && seer.alive) validSeers.add(e.from);
            
            if (e.result === true) confirmedBlacks.add(e.target);
            else confirmedWhites.add(e.target);
        }
    }

    // 確定白黒への加減算
    for (const id of Array.from(confirmedBlacks)) {
        if (scores[id] !== undefined) {
            scores[id] += 80.0;
            if (reasons[id] === "gray") reasons[id] = "black";
        }
    }
    for (const id of Array.from(confirmedWhites)) {
        if (scores[id] !== undefined) scores[id] -= 80.0;
    }

    // 各種COの分類
    const isCoSet = new Set<string>();
    const claimedSeers = new Set<string>();
    const claimedMediums = new Set<string>();
    const claimedCoroners = new Set<string>();
    const claimedEnemies = new Set<string>();
    const claimedTeruteru = new Set<string>();

    for (const e of game.evidence) {
        const p = game.players.find(pl => pl.id === e.from);
        if (p && p.alive) {
            isCoSet.add(e.from);
            switch (e.type) {
                case 'divine': claimedSeers.add(e.from); break;
                case 'medium_co': claimedMediums.add(e.from); break;
                case 'coroner_co': claimedCoroners.add(e.from); break;
                case 'enemy_co': claimedEnemies.add(e.from); break;
                case 'teruteru_co': claimedTeruteru.add(e.from); break;
                case 'mason_co': break; 
            }
        }
    }

    // 人外CO・テルテルCOの処理
    for (const id of Array.from(claimedEnemies)) {
        if (scores[id] !== undefined) {
            scores[id] += 1000.0;
            reasons[id] = "enemy_co";
        }
    }
    for (const id of Array.from(claimedTeruteru)) {
        if (scores[id] !== undefined) {
            if (game.dayCount <= 2) {
                scores[id] -= 100.0 * traitVals.logical;
                reasons[id] = "teruteru_avoid";
            } else {
                scores[id] += 150.0 * traitVals.logical;
                reasons[id] = "teruteru_suspect";
            }
        }
    }

    // ==========================================
    // 3. ローラー＆ライン考察
    // ==========================================
    const chatCounts: Record<string, number> = {};
    game.chatLog?.filter(l => l.day === game.dayCount).forEach(l => {
        chatCounts[l.id] = (chatCounts[l.id] || 0) + 1;
    });

    for (const p of others) {
        const id = p.id;
        const chatCount = chatCounts[id] || 0;

        let hasGoodVote = false;
        for (const log of game.voteLog || []) {
            const myVote = log.votes[id];
            if (myVote && (liars.has(myVote) || confirmedBlacks.has(myVote))) {
                hasGoodVote = true;
            }
        }

        let isProtectingLiar = false;
        for (const e of game.evidence) {
            if (e.from === id && e.result === false && liars.has(e.target)) {
                isProtectingLiar = true;
            }
        }

        // 占い師ローラー
        if (claimedSeers.has(id) && !liars.has(id) && validSeers.has(id)) {
            if (validSeers.size < 2) {
                if (scores[id] !== undefined) scores[id] -= 60.0 * traitVals.protect;
            } else {
                if (scores[id] !== undefined) {
                    scores[id] += 80.0 * traitVals.roller;
                    if (chatCount <= game.dayCount) scores[id] += 40.0;
                    if (hasGoodVote) scores[id] -= 30.0; else if (game.dayCount >= 3) scores[id] += 30.0;
                    if (isProtectingLiar) { scores[id] += 80.0; reasons[id] = "line_defense"; }
                }
                if (reasons[id] === "gray") reasons[id] = "roller";
            }
        }

        // 霊能者ローラー
        if (claimedMediums.has(id) && !liars.has(id)) {
            if (claimedMediums.size < 2) {
                if (scores[id] !== undefined) scores[id] -= 60.0 * traitVals.protect;
            } else {
                if (scores[id] !== undefined) {
                    scores[id] += 80.0 * traitVals.roller;
                    if (chatCount <= game.dayCount) scores[id] += 40.0;
                    if (hasGoodVote) scores[id] -= 30.0; else if (game.dayCount >= 3) scores[id] += 30.0;
                    if (isProtectingLiar) { scores[id] += 80.0; reasons[id] = "line_defense"; }
                }
                if (reasons[id] === "gray") reasons[id] = "roller";
            }
        }
    }

    // ==========================================
    // 4. 過去の投票ログからの私怨＆論理
    // ==========================================
    const isPublicVote = game.settings.voteTransparency === 'public' || (game.voteLog && game.voteLog.length > 0);
    if (isPublicVote) {
        const suspects = new Set(liars);
        confirmedBlacks.forEach(b => suspects.add(b));

        const lastLog = game.voteLog ? game.voteLog[game.voteLog.length - 1] : null;
        if (lastLog) {
            for (const p of others) {
                const id = p.id;
                // 黒確定に投票しなかった奴を疑う（ライン考察）
                if (suspects.size > 0) {
                    const votedFor = lastLog.votes[id];
                    if (votedFor && !suspects.has(votedFor)) {
                        if (scores[id] !== undefined && scores[id] < 1000.0) {
                            scores[id] += 40.0 * traitVals.logical;
                            if (reasons[id] === "gray") reasons[id] = "line_defense";
                        }
                    }
                }
                // 自分に投票した奴への私怨
                const votedFor = lastLog.votes[id];
                if (votedFor === npc.id) {
                    if (scores[id] !== undefined) {
                        scores[id] += 40.0 * traitVals.aggressive;
                        if (reasons[id] === "gray") reasons[id] = "revenge";
                    }
                }
            }
        }
    }

    // ==========================================
    // 5. グレーへのランダム加算と無口ペナルティ
    // ==========================================
    for (const p of others) {
        const id = p.id;
        const sVal = scores[id] || 0.0;
        if (sVal >= 100.0 || sVal <= -100.0) continue;

        const isCo = isCoSet.has(id);
        const isWhite = confirmedWhites.has(id);
        
        if (!isCo && !isWhite) {
            if (scores[id] !== undefined) {
                scores[id] += 20.0 * traitVals.gray;
                if (game.dayCount >= 3) scores[id] += 30.0;
                
                const chatCount = chatCounts[id] || 0;
                if (chatCount === 0) {
                    scores[id] += 15.0 * traitVals.silence;
                    // 🌟 理由を「ただのグレー」から「無口なグレー」に解像度アップ
                    if (reasons[id] === "gray") reasons[id] = "quiet_gray";
                }
            }
        }
    }

    // ==========================================
    // 6. 陣営・役職特有のえげつない戦術（身内切り・狂人ムーブ）
    // ==========================================
    
    // 🐺 人狼の戦術
    if (['人狼', '狂信者'].includes(npc.role as string)) {
        const wolfIds = new Set(alivePlayers.filter(p => p.role === '人狼').map(p => p.id));
        
        // ① パワープレイ（PP）判定：人狼側が半数以上なら、村人を堂々と処刑する
        if (wolfIds.size >= alivePlayers.length - wolfIds.size) {
            const target = others.find(p => !wolfIds.has(p.id));
            if (target) return { targetId: target.id, reasonType: "wolf_pp" };
        }
        
        // ② 身内切り（トカゲの尻尾切り）ロジック
        for (const wId of Array.from(wolfIds)) {
            if (scores[wId] !== undefined) {
                if (scores[wId] >= 300.0) {
                    // 仲間が既に村から猛烈に疑われている場合、かばうと自分も疑われるため「あえて見捨てて一緒に叩く」
                    scores[wId] += 150.0;
                    reasons[wId] = "wolf_cut_ties";
                } else {
                    // まだバレていない仲間は絶対に守る
                    scores[wId] = -9999.0;
                }
            }
        }
    }

    // 🤡 狂人の盤面荒らし戦術
    if (npc.role === '狂人') {
        for (const p of others) {
            const id = p.id;
            // 狂人は「白確定」や「役職者」など、村にとって有益な人物をあえて狙って邪魔をする
            if (confirmedWhites.has(id) || claimedSeers.has(id)) {
                if (scores[id] !== undefined) {
                    scores[id] += 40.0;
                    if (reasons[id] === "gray") reasons[id] = "madman_chaos";
                }
            }
        }
    }

    // 🛡️ 人間陣営の絶対防御
    if (npc.role === '共有者') {
        const partner = alivePlayers.find(p => p.role === '共有者' && p.id !== npc.id);
        if (partner && scores[partner.id] !== undefined) scores[partner.id] = -9999.0;
    }
    
    if (game.lovers && game.lovers.includes(npc.id)) {
        const partnerId = game.lovers.find(id => id !== npc.id);
        if (partnerId && scores[partnerId] !== undefined) scores[partnerId] = -9999.0;
    }

    // ==========================================
    // 7. 乱数の適用と最終決定
    // ==========================================
    for (const id in scores) {
        if (scores[id] > -5000.0) {
            scores[id] += Math.random() * traitVals.random;
        }
    }

    const sortedCandidates = Object.entries(scores)
        .filter(([, s]) => s > -9000.0)
        .sort((a, b) => b[1] - a[1]);

    if (sortedCandidates.length === 0) {
        return "skip";
    }

    const topId = sortedCandidates[0][0];
    return { targetId: topId, reasonType: reasons[topId] || "gray" };
}