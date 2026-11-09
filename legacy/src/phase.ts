// src/phase.ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import * as Messages from './messages';
import * as DB from './db';
import * as AI from './aiUtils'; 
import * as NPC from './npcLogic';
import { GameState, Player } from './types'; 
import * as Roles from './roles';
import { TIMING, MSG, UI, GAYA_DICTIONARY, EASY_WORDS, fill, getDictatorCoMessage, getDivideReply, getRoleClaimReply, getWolfBriefing } from './gameConfig';

import { getGame, resetGame } from './state';

// 任意の秒数だけ処理を一時停止する関数（1000 = 1秒）
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function kickFromWolfChannel(game: GameState, deadPlayerId: string) {
    if (game.wolfChannel && !deadPlayerId.startsWith('npc_')) {
        try {
            await game.wolfChannel.permissionOverwrites.delete(deadPlayerId);
            await Messages.safeSend(game.wolfChannel, fill(MSG.wolfChat.kicked, { name: game.players.find((p: Player) => p.id === deadPlayerId)?.name || '不明' }));
        } catch (e) {
            console.error("追放エラー:", e);
        }
    }
}

export function setSafeTimeout(game: GameState, callback: () => void, ms: number) {
    if (!game.timers) game.timers = [];
    const timer = setTimeout(() => {
        game.timers = game.timers.filter((t: any) => t !== timer);
        if (game.state === 'idle') return;
        try {
            callback();
        } catch (e) {
            console.error('[setSafeTimeout] コールバック内でエラーが発生しました:', e);
        }
    }, ms);
    game.timers.push(timer);
}

export function trackCollector(game: GameState, collector: { stop: () => void } & { once?: (event: string, fn: () => void) => void }): void {
    if (!game.collectors) game.collectors = [];
    game.collectors.push(collector);
    if (typeof collector.once === 'function') {
        collector.once('end', () => {
            if (game.collectors) {
                game.collectors = game.collectors.filter(c => c !== collector);
            }
        });
    }
}

export function decideRoles(game: GameState, total: number) {
    let wolfCount = game.settings.wolfMode === 'auto' ? (total >= 11 ? 3 : (total >= 6 ? 2 : 1)) : game.settings.wolfMode;
    if (wolfCount >= total / 2) wolfCount = Math.floor((total - 1) / 2) || 1;
    
    const roles = [];
    const wolfRoleName = game.settings.loquaciousMode ? '饒舌な人狼' : '人狼';
    for (let i = 0; i < wolfCount; i++) roles.push(wolfRoleName);
    
    game.settings.roles.forEach((k: string) => { 
        if (Roles.ROLE_MAP[k] && k !== 'loquacious') {
            roles.push(Roles.ROLE_MAP[k]);
            if (k === 'freemason') roles.push(Roles.ROLE_MAP[k]);
        } 
    });
    while (roles.length < total) roles.push('村人');
    return roles;
}

export function setupSpecialRoles(game: GameState, total: number) {
    const naturalLiars = game.players.filter((p: Player) => p.isNpc && ['狂人', '妖狐', '狂信者', 'テルテル', '妖術師'].includes(p.role as string));
    const wolves = game.players.filter((p: Player) => p.isNpc && Roles.isActualWolf(p.role as string));

    if (game.settings.roles.includes('seer')) {
        if (naturalLiars.length > 0 && Math.random() < 0.6) { 
            const faker = naturalLiars[Math.floor(Math.random() * naturalLiars.length)];
            faker.isFakeSeer = true;
            if (Math.random() < 0.4) faker.isHiding = true; 
        } else if (wolves.length > 0 && Math.random() < 0.2) { 
            const wolfFaker = wolves[Math.floor(Math.random() * wolves.length)];
            wolfFaker.isFakeSeer = true;
            if (Math.random() < 0.3) wolfFaker.isHiding = true; 
        }
    }

    const isMediumInSettings = game.settings.roles.includes('medium');
    const madmenForMedium = game.players.filter((p: Player) => p.isNpc && !p.isFakeSeer && ['狂人', '狂信者'].includes(p.role as string));
    const wolvesForMedium = game.players.filter((p: Player) => p.isNpc && !p.isFakeSeer && Roles.isActualWolf(p.role as string));

    if (isMediumInSettings) {
        if (madmenForMedium.length > 0 && Math.random() < 0.3) { 
            const fM = madmenForMedium[Math.floor(Math.random() * madmenForMedium.length)];
            fM.isFakeMedium = true;
            if (Math.random() < 0.3) fM.isHiding = true;
        } else if (wolvesForMedium.length > 0 && Math.random() < 0.1) { 
            const fM = wolvesForMedium[Math.floor(Math.random() * wolvesForMedium.length)];
            fM.isFakeMedium = true;
            if (Math.random() < 0.2) fM.isHiding = true; 
        }
    }

    const trueMediums = game.players.filter((p: Player) => p.isNpc && p.role === '霊能者');
    trueMediums.forEach((tm: any) => {
        const pTone = tm.personality || 'normal';
        let hideChance = 0.0;
        if (Math.random() < hideChance) tm.isHiding = true;
    });

    // ★修正: ここにあったNPCキューピッドの処理を startNightPhase に移動しました

    const trueSeer = game.players.find((p: Player) => p.isNpc && p.role === '占い師');
    if (trueSeer) {
        const pTone = trueSeer.personality || 'normal';
        let hideChance = 0.3;
        if (pTone === 'cautious') hideChance = 0.8;
        if (pTone === 'logical') hideChance = 0.5;
        if (pTone === 'aggressive' || pTone === 'joker') hideChance = 0.1;
        if (Math.random() < hideChance) {
            trueSeer.isHiding = true;
        }
    }
}

function generateDeepReasonPhrase(speaker: any, targetName: string, reason: string) {
    const p = speaker.personality || 'normal';
    
    // 🌟 追加：npcLogicの新しい詳細な理由を、GAYA辞書のキーにマッピングする
    let dictKey = reason;
    if (['trusted_black', 'doubtful_black', 'my_black_result'].includes(reason)) {
        dictKey = 'black'; // 黒出し・黒吊り系
    } else if (reason === 'seer_co_suspect') {
        dictKey = 'roller'; // 占い師ローラー系
    } else if (reason === 'hostile_seer') {
        dictKey = 'revenge'; // 自分（仲間）に黒出ししてきた占い師への反撃
    }

    if (GAYA_DICTIONARY[dictKey] && GAYA_DICTIONARY[dictKey][p]) {
        const list = GAYA_DICTIONARY[dictKey][p];
        const template = list[Math.floor(Math.random() * list.length)];
        return template.replace('TARGET', targetName);
    }
    return Messages.getDynamicGayaPhrase('attacking', p, targetName);
}

function startGaya(game: GameState) {
    if (game.gayaInterval) {
        clearInterval(game.gayaInterval as NodeJS.Timeout); // ★キャストを追加
        clearTimeout(game.gayaInterval as any);
    }

    // 次に喋る時間を記録する変数（最初は3〜8秒後）
    let nextSpeakTime = Date.now() + (3000 + Math.random() * 5000);

    game.gayaInterval = setInterval(async () => {
        try {
            if (game.state !== 'playing' || !game.channel) {
                clearInterval(game.gayaInterval as NodeJS.Timeout);
                return;
            }

            const now = Date.now();
            if (now < nextSpeakTime) return; // まだ喋る時間じゃないならスルー

            const aliveNpcs = game.players.filter((p: Player) => p.isNpc && p.alive);
            if (aliveNpcs.length === 0) return;

            // ============================================================
            // 💡 性格被り防止ロジック（性格が未設定のNPCに割り当て）
            // ============================================================
const validPersonalities = [
    'aggressive', 'witty', 'serious', 'normal', 'sans', 'jax', 
    'ninja', 'chuuni', 'dio'
];
            
            aliveNpcs.forEach((npc: Player) => {
                if (!npc.personality || !validPersonalities.includes(npc.personality)) {
                    const usedPersonalities = game.players
                        .filter((p: Player) => p.isNpc && p.personality)
                        .map((p: Player) => p.personality);
                    let availablePersonalities = validPersonalities.filter(p => !usedPersonalities.includes(p));
                    if (availablePersonalities.length === 0) availablePersonalities = validPersonalities;
                    npc.personality = availablePersonalities[Math.floor(Math.random() * availablePersonalities.length)];
                }
            });

            // ============================================================
            // 💡 追加：性格による「発言率（出しゃばり度）」の重み付け
            // ============================================================
            const getSpeakWeight = (personality: string) => {
                switch(personality) {
                    case 'jax':
                    case 'aggressive':
                        return 100; // 【高】めちゃくちゃ出しゃばる。人の話を遮って荒らす
                    case 'dio':
                    case 'chuuni':
                    case 'ninja':
                        return 70;  // 【やや高】自己主張が激しい
                    case 'witty':
                    case 'normal':
                        return 50;  // 【普通】標準的な頻度
                    case 'serious':
                        return 30;  // 【低】口数は少ない。必要な時しか喋らない
                    case 'sans':
                        return 10;  // 【激低】基本寝てる。たまーーに起きてメタ発言を落とす
                    default:
                        return 50;
                }
            };

            // ============================================================
            // 💡 発言者選定：返答キュー優先 → クールダウン考慮の重み付きガチャ
            // ============================================================
            if (!game.lastSpeakerTime) game.lastSpeakerTime = {};
            if (!game.pendingReplyQueue) game.pendingReplyQueue = [];

            const cooldown = 15000; // 15秒以内に喋ったNPCは連投禁止

            let speaker: Player;

            // 名指しされたNPCがいればキューから先に喋らせる
            if (game.pendingReplyQueue.length > 0) {
                // キュー内のNPCが生存中かチェックしてから取り出す
                let queued: Player | undefined;
                while (game.pendingReplyQueue.length > 0) {
                    const candidate = game.pendingReplyQueue.shift()!;
                    if (candidate.alive) { queued = candidate; break; }
                }
                if (queued) {
                    speaker = queued;
                } else {
                    // キューが空になったのでガチャへ
                    speaker = aliveNpcs[0];
                }
            } else {
                // クールダウン中を除外してガチャ
                const eligibleNpcs = aliveNpcs.filter(npc => {
                    const lastSpoke = game.lastSpeakerTime![npc.id] || 0;
                    return Date.now() - lastSpoke > cooldown;
                });
                const pool = eligibleNpcs.length > 0 ? eligibleNpcs : aliveNpcs; // 全員クールダウン中なら全員対象

                let totalWeight = 0;
                const weightedNpcs = pool.map(npc => {
                    const weight = getSpeakWeight(npc.personality as string);
                    totalWeight += weight;
                    return { npc, weight };
                });

                let randomValue = Math.random() * totalWeight;
                speaker = pool[0]; // 万が一のためのフォールバック
                for (const item of weightedNpcs) {
                    randomValue -= item.weight;
                    if (randomValue <= 0) {
                        speaker = item.npc;
                        break;
                    }
                }
            }

            // ============================================================
            // ⚠️ 前回消えてしまっていた必須変数定義（復活！）
            // ============================================================
            let category = 'neutral';
            let accused = false;
            let targetForPhrase: Player | null | undefined = null;
            let reasonForPhrase = 'gray';

            let neutralChance = 0.4;
            if (game.dayCount === 1) neutralChance = 0.8;
            else if (game.dayCount === 2) neutralChance = 0.4;
            else if (game.dayCount === 3) neutralChance = 0.2;
            else neutralChance = 0.1;

            accused = (game.evidence || []).some((e: any) => e.target === speaker.id && e.result === true && e.visible); 
            if (accused) {
                category = 'defensive';
            } else if (Math.random() < neutralChance) { 
                category = (game.dayCount === 1) ? 'day1' : 'neutral';
            } else { 
                const voteInfo = NPC.getNpcVoteTarget(speaker, game);
                if (voteInfo && voteInfo !== 'skip') {
                    const targetId = typeof voteInfo === 'string' ? voteInfo : voteInfo.targetId;
                    reasonForPhrase = typeof voteInfo === 'string' ? 'gray' : voteInfo.reasonType;
                    if (targetId !== 'skip' && targetId !== speaker.id) {
                        targetForPhrase = game.players.find((p: Player) => p.id === targetId);
                        category = 'attacking';
                    } else {
                        category = (game.dayCount === 1) ? 'day1' : 'neutral';
                    }
                } else {
                    category = (game.dayCount === 1) ? 'day1' : 'neutral';
                }
            }

            // ============================================================
            // 🤖 AI呼び出しを廃止し、辞書からの定型文に一本化
            // ============================================================
            nextSpeakTime = now + 9999999; 

            let phrase = "";
            const anyGame = game as any;
            if (!anyGame.usedGayaLogs) anyGame.usedGayaLogs = [];

            for (let i = 0; i < 5; i++) {
                const dict = (GAYA_DICTIONARY as any)[speaker.personality || 'normal'] || GAYA_DICTIONARY['normal'];
                
                if (category === 'day1') {
                    const lines = dict['day1'] || dict['neutral'];
                    phrase = lines[Math.floor(Math.random() * lines.length)];
                } else if (category === 'neutral') {
                    const lines = dict['neutral'];
                    phrase = lines[Math.floor(Math.random() * lines.length)];
                } else if (category === 'defensive') {
                    phrase = Messages.getDynamicGayaPhrase('defensive', speaker.personality, null);
                } else if (category === 'attacking' && targetForPhrase) {
                    phrase = generateDeepReasonPhrase(speaker, targetForPhrase.name, reasonForPhrase);
                }

                if (!phrase) {
                    const fallbackLines = dict['neutral'] || GAYA_DICTIONARY['normal']['neutral'];
                    phrase = fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
                }

                if (!anyGame.usedGayaLogs.includes(phrase)) break; 
            }

            anyGame.usedGayaLogs.push(phrase);
            if (anyGame.usedGayaLogs.length > 20) anyGame.usedGayaLogs.shift();

            // ⏱️ テンポ（緩急）の再計算
            const isHeated = (category === 'attacking' || category === 'defensive');
            let skipThisTurn = false;

            if (isHeated) {
                // 🔥 白熱モード：3秒〜6秒後に次の人が喋る
                nextSpeakTime = Date.now() + 3000 + Math.random() * 3000;
            } else {
                // ☕ 平和モード：8秒〜14秒後に次の人が喋る
                nextSpeakTime = Date.now() + 8000 + Math.random() * 6000;
                
                if (Math.random() < TIMING.gayaSkipChance) {
                    skipThisTurn = true;
                    // サボった場合はさらに時間をあける（沈黙の間）
                    nextSpeakTime += 5000; 
                }
            }

            // 発言を送信
            if (!skipThisTurn) {
                if (!game.chatLog) game.chatLog = [];
                if (!game.timeline) game.timeline = []; 
                
                game.chatLog.push({ id: speaker.id, name: speaker.name, content: phrase, day: game.dayCount });
                game.timeline.push({ type: 'chat', day: game.dayCount, id: speaker.id, name: speaker.name, content: phrase });

                if (game.chatLog.length > 100) game.chatLog.shift();
                
                await Messages.safeSend(game.channel, `**${speaker.name}**: 「${phrase}」`);

                // 発言時刻を記録（クールダウン用）
                if (!game.lastSpeakerTime) game.lastSpeakerTime = {};
                game.lastSpeakerTime[speaker.id] = Date.now();

                // NPC発言中に他のNPCが名指しされたら返答キューに積む（低優先度）
                if (!game.pendingReplyQueue) game.pendingReplyQueue = [];
                const mentionedByNpc = aliveNpcs.find(npc =>
                    npc.id !== speaker.id && phrase.includes(npc.name)
                );
                if (mentionedByNpc && !game.pendingReplyQueue.some(p => p.id === mentionedByNpc.id)) {
                    game.pendingReplyQueue.push(mentionedByNpc); // pushで低優先度（後回し）
                }
            }

        } catch (e) {
            console.error("NPC Gaya Error:", e);
            // エラー時は10秒後にリトライ
            nextSpeakTime = Date.now() + 10000;
        }
    }, 1000); // 1秒ごとに時間をチェックするループ
}


export async function startDayPhase(game: GameState) {
    if (!game.timeline) game.timeline = [];

    game.timeline.push({ type: 'phase', content: `☀️ DAY ${game.dayCount}`, detail: '昼のフェーズ' });

    const aliveCount = game.players.filter((p: Player) => p.alive).length;
    let duration = game.settings.discussionTime;
    
    let textMsg = fill(MSG.day.morningAnnounce, { day: game.dayCount, alive: aliveCount, duration });
    await Messages.safeSend(game.channel, { content: textMsg });

    announceSeerResults(game).catch(e => console.error(e));
    announceMediumResults(game).catch(e => console.error(e));
    if (game.settings.gayaMode && game.npcCount > 0) {
        // CO発言がchatLogに積まれてからガヤ開始（seerAnnounceDelay + 2秒の余裕）
        setSafeTimeout(game, () => startGaya(game), TIMING.seerAnnounceDelay + 2000);
    }

    const loquaciousWolves = game.dayCount > 1 
        ? game.players.filter((p: Player) => 
            p.alive && (p.role === '饒舌な人狼' || (game.settings.loquaciousMode && Roles.isActualWolf(p.role as string)))
        )
        : [];

    const msgCollector = game.channel.createMessageCollector({ 
        filter: (m: any) => !m.author.bot, 
        time: duration * 1000 
    });
    trackCollector(game, msgCollector);

    // 🌟 修正：人間の発言をログに記録する処理のみ残す
    msgCollector.on('collect', (m: any) => {
        const player = game.players.find((p: Player) => p.id === m.author.id);
        
        if (player && player.alive) {
            if (!game.chatLog) game.chatLog = [];
            game.chatLog.push({ id: player.id, name: player.name, content: m.content, day: game.dayCount });
            
            if (!game.timeline) game.timeline = [];
            game.timeline.push({ type: 'chat', day: game.dayCount, id: player.id, name: player.name, content: m.content });
            
            if (game.chatLog.length > 100) game.chatLog.shift();
        }

        // 饒舌な人狼の処理
        if (player && loquaciousWolves.some((w: any) => w.id === player.id) && !player.hasSaidWord) {
            if (m.content.includes(player.wordToSay!)) {
                player.hasSaidWord = true;
                Messages.safeDM(player.user, fill(MSG.day.loquaciousSuccess, { word: player.wordToSay! }));
            }
        }
    });

    if (loquaciousWolves.length > 0) {
        loquaciousWolves.forEach((w: any) => {
            w.wordToSay = EASY_WORDS[Math.floor(Math.random() * EASY_WORDS.length)];
            w.hasSaidWord = false;
            
            if (!w.isNpc) {
                Messages.safeDM(w.user, fill(MSG.day.loquaciousMission, { word: w.wordToSay! }));
            } else {
                w.hasSaidWord = true; 
            }
        });
    }

    setSafeTimeout(game, async () => {
        try {
            await Messages.safeSend(game.channel, { content: MSG.day.discussionEnd });

            if (game.gayaInterval) clearInterval(game.gayaInterval);
            msgCollector.stop();

            let suddenDeaths: string[] = [];
            loquaciousWolves.forEach((w: any) => {
                if (!w.hasSaidWord && w.alive) {
                    w.alive = false;
                    w.deathDay = game.dayCount;
                    w.deathReason = 'sudden_death';
                    kickFromWolfChannel(game, w.id);

                    suddenDeaths.push(w.name);
                    game.history.push(`🌑 突然死: ${w.name} (饒舌なお題未達成)`);
                    game.timeline.push({ type: 'death', day: game.dayCount, content: `🌑 突然死: ${w.name}` });
                }
            });

            if (suddenDeaths.length > 0) {
                for (const w of loquaciousWolves) {
                    if (!w.alive && w.deathReason === 'sudden_death') {
                        await checkLoversBond(game, w);
                        await checkNecromancerBond(game, w);
                    }
                }
                await Messages.safeSend(game.channel, fill(MSG.day.suddenDeath, { names: suddenDeaths.join('**, **') }));
                if (await checkWin(game)) return;
            }

            startVotingPhase(game);
        } catch (e) {
            console.error("Day End Error:", e);
            startVotingPhase(game);
        }
    }, duration * 1000);
}

async function announceSeerResults(game: GameState) {
    let seers = game.players.filter((p: Player) => p.alive && (p.role === '占い師' || p.isFakeSeer || (!p.isNpc && game.actions.some((a: any) => a.type === 'divine' && a.from === p.id))));
    if (seers.length === 0) return;
    seers.sort(() => Math.random() - 0.5);

    setSafeTimeout(game, async () => {
        for (const seer of seers) {
            try {
                let act: any = null;
                let shouldReveal = true;

                if (seer.role === '占い師' && seer.isNpc) {
                    act = game.actions.find((a: any) => a.type === 'divine' && a.from === seer.id);
                } 
                else if (seer.isNpc && seer.isFakeSeer) {
                    const myHistory = game.evidence.filter((e: any) => e.type === 'divine' && e.from === seer.id).map((e: any) => e.target);
                    const others = game.players.filter((p: Player) => p.id !== seer.id && p.alive && !myHistory.includes(p.id));
                    
                    if (others.length > 0) {
                        let target = others[Math.floor(Math.random() * others.length)];
                        const rivalWhites = game.evidence.filter((e: any) => e.type === 'divine' && e.result === false && e.from !== seer.id && e.visible);
                        if (rivalWhites.length > 0 && Math.random() < 0.5) {
                            const panda = rivalWhites.filter((e: any) => 
                                e.target !== seer.id && 
                                !myHistory.includes(e.target) &&
                                game.players.some((p: Player) => p.id === e.target && p.alive)
                            );
                            if (panda.length > 0) {
                                const randomPanda = panda[Math.floor(Math.random() * panda.length)];
                                const foundPlayer = game.players.find((p: Player) => p.id === randomPanda.target);
                                if (foundPlayer) target = foundPlayer;
                            }
                        }
                        const myBlacks = game.evidence.filter((e: any) => e.type === 'divine' && e.from === seer.id && e.result === true).length;
                        const wolfCount = game.settings.wolfMode === 'auto' ? (game.players.length >= 11 ? 3 : (game.players.length >= 6 ? 2 : 1)) : (typeof game.settings.wolfMode === 'number' ? game.settings.wolfMode : 2);
                        
                        let isBlack = game.dayCount >= 3 ? (Math.random() < 0.4) : (Math.random() < 0.2);
                        if (myBlacks >= wolfCount) isBlack = false;

                        if (seer.role === '狂信者' || seer.role === '妖術師' || Roles.isActualWolf(seer.role as string)) {
                            const wolves = game.players.filter((p: Player) => Roles.isActualWolf(p.role as string)).map((p: Player) => p.id);
                            if (wolves.includes(target.id)) isBlack = false; 
                        }
                        act = { type: 'divine', from: seer.id, target: target.id, result: isBlack };
                        game.actions.push(act);
                    }
                } else if (!seer.isNpc) {
                    act = game.actions.find((a: any) => a.type === 'divine' && a.from === seer.id);
                }

                if (!act) continue;

                if (seer.isNpc) {
                    if (seer.isHiding) {
                        let forceReveal = act.result === true || game.dayCount >= 3;
                        if (forceReveal) seer.isHiding = false; else shouldReveal = false;
                    }
                } else {
                    if (seer.hideStrategy) {
                        if (act.result) { 
                            seer.hideStrategy = false;
                            Messages.safeDM(seer.user, MSG.roleActions.seerBlackFound); 
                        }
                        else { 
                            shouldReveal = false;
                            Messages.safeDM(seer.user, MSG.roleActions.seerHiding); 
                        }
                    }
                }

                const existingEv = game.evidence.find((e: any) => e.day === game.dayCount && e.from === seer.id);
                if (!existingEv) game.evidence.push({ type: 'divine', day: game.dayCount, from: act.from, target: act.target, result: act.result, visible: shouldReveal });

                if (shouldReveal) {
                    const hiddenLogs = game.evidence.filter((e: any) => e.from === seer.id && !e.visible);
                    hiddenLogs.forEach((e: any) => e.visible = true);
                    
                    let revealText = "";
                    const currentTargetName = game.players.find((p: Player) => p.id === act.target)?.name || '不明';
                    const resStr = act.result ? '人狼🐺' : '人間👤';

                    if (hiddenLogs.length > 0) {
                        let pastResults = "";
                        hiddenLogs.forEach((e: any) => { 
                            const tName = game.players.find((p: Player) => p.id === e.target)?.name || '不明';
                            pastResults += `${e.day}日目の夜は **${tName}** を占い、結果は **【${e.result ? '人狼🐺' : '人間👤'}】**。`; 
                        });
                        revealText = fill(MSG.roleActions.seerCoWithHistory, { seer: seer.name, pastResults, today: currentTargetName, result: resStr });
                    } else {
                        revealText = fill(MSG.roleActions.seerCo, { seer: seer.name, target: currentTargetName, result: resStr });
                    }

                    let targetCh = game.channel;
                    if (game.dividedGroups) {
                        targetCh = game.dividedGroups.roomA.includes(seer.id) ? game.sectorAChannel : game.sectorBChannel;
                    }
                    await Messages.safeSend(targetCh, { content: revealText });

                    if (!game.chatLog) game.chatLog = [];
                    if (!game.timeline) game.timeline = []; 
                    
                    game.chatLog.push({ id: seer.id, name: seer.name, content: `占い結果: ${currentTargetName} は ${act.result ? '黒' : '白'}`, day: game.dayCount });
                    game.timeline.push({ type: 'chat', day: game.dayCount, id: seer.id, name: seer.name, content: `占い結果: ${currentTargetName} は ${act.result ? '黒' : '白'}` });
                }
            } catch(e) { console.error("Seer Announce Error:", e); }
        }
    }, TIMING.seerAnnounceDelay);
}

async function announceMediumResults(game: GameState) {
    const hasResult = !!game.lastExecutionResult; // 処刑者がいるか判定
    const executedId = game.lastExecutionResult?.id;
    const executedPlayer = executedId ? game.players.find((p: Player) => p.id === executedId) : null;

    let announcers = game.players.filter((p: Player) => p.alive && (
        p.role === '霊能者' ||
        (p.isNpc && p.isFakeMedium) ||
        game.actions.some((a: any) => a.type === 'fake_medium' && a.from === p.id)
    ));
    if (announcers.length === 0) return;

    setSafeTimeout(game, async () => {
        for (const med of announcers) {
            try {
                let isBlack = false;
                let shouldReveal = true;
                let actExists = true; // 🌟 デフォルトで存在することにする

                if (med.role === '霊能者') {
                    if (hasResult) isBlack = game.lastExecutionResult!.isWolf;
                    if (med.isNpc) {
                        if (med.isHiding) {
                            if (isBlack || game.dayCount >= 3) med.isHiding = false;
                            else shouldReveal = false;
                        }
                    } else {
                        if (med.hideStrategy) shouldReveal = false;
                    }
                } else if (med.isNpc && med.isFakeMedium) {
                    if (hasResult) {
                        isBlack = !game.lastExecutionResult!.isWolf; 
                        if (Math.random() < 0.2) isBlack = game.lastExecutionResult!.isWolf; 
                    }
                    if (med.isHiding) {
                        if (isBlack || game.dayCount >= 3) med.isHiding = false;
                        else shouldReveal = false;
                    }
                } else {
                    const action = game.actions.find((a: any) => a.type === 'fake_medium' && a.from === med.id);
                    if (action) {
                        isBlack = action.result as boolean;
                    }
                    if (med.hideStrategy) shouldReveal = false;
                }

                if (!actExists) continue;

                // 🌟 証拠(evidence)の記録処理 (hasResult が false の場合も CO の記録を残す)
                const existingEv = game.evidence?.find((e: any) => e.type === 'medium_co' && e.day === game.dayCount && e.from === med.id);
                if (!existingEv) {
                    if (!game.evidence) game.evidence = [];
                    game.evidence.push({ type: 'medium_co', day: game.dayCount, from: med.id, target: executedId as string || 'none', result: isBlack, visible: shouldReveal });
                }

                if (shouldReveal) {
                    const hiddenLogs = game.evidence?.filter((e: any) => e.type === 'medium_co' && e.from === med.id && !e.visible) || [];
                    hiddenLogs.forEach((e: any) => e.visible = true);

                    let announceText = "";
                    if (hasResult) {
                        const reportedRole = isBlack ? '人狼🐺' : '人間👤';
                        const targetName = executedPlayer?.name || '不明';
                        
                        let pastResults = "";
                        if (hiddenLogs.length > 0) {
                            hiddenLogs.forEach((e: any) => {
                                if (e.day === game.dayCount) return; 
                                const tName = game.players.find((p: Player) => p.id === e.target)?.name || '不明';
                                pastResults += `・${e.day}日目の朝: **${tName}** ➔ **【${e.result ? '人狼🐺' : '人間👤'}】**\n`;
                            });
                            announceText = `👻 **${med.name} の霊媒結果 (CO)**\n「これまで潜伏していましたが、結果を公表します。」\n${pastResults}そして昨晩処刑された ${targetName} は **【${reportedRole}】** でした。`;
                        } else {
                            announceText = `👻 **${med.name} の霊媒結果**\n「昨晩処刑された ${targetName} は **【${reportedRole}】** でした。」`;
                        }
                        
                        if (!game.timeline) game.timeline = [];
                        game.timeline.push({ type: 'chat', day: game.dayCount, id: med.id, name: med.name, content: `霊媒結果: ${targetName} は ${isBlack ? '黒' : '白'}` });
                    } else {
                        announceText = `👻 **${med.name} 霊能者CO**`;
                        if (!game.timeline) game.timeline = [];
                        game.timeline.push({ type: 'chat', day: game.dayCount, id: med.id, name: med.name, content: `霊能者CO（結果なし）` });
                    }

                    let targetCh = game.channel;
                    if (game.dividedGroups) targetCh = game.dividedGroups.roomA.includes(med.id) ? game.sectorAChannel : game.sectorBChannel;
                    await Messages.safeSend(targetCh, { content: announceText });

                    if (!game.chatLog) game.chatLog = [];
                    if (hasResult) {
                        game.chatLog.push({ id: med.id, name: med.name, content: `霊媒結果: ${executedPlayer?.name || '不明'} は ${isBlack ? '黒' : '白'}`, day: game.dayCount });
                    } else {
                        game.chatLog.push({ id: med.id, name: med.name, content: `霊能者CO（結果なし）`, day: game.dayCount });
                    }
                    await sleep(2000); 
                }
            } catch (e) { console.error("Medium Announce Error:", e); }
        }
    }, TIMING.seerAnnounceDelay + 3000);
}

export async function startVotingPhase(game: GameState) {
    const alivePlayers = game.players.filter((p: Player) => p.alive);
    
    let voteTargets = alivePlayers;
    if (game.isRevote && game.revoteCandidates && game.revoteCandidates.length > 0) {
        voteTargets = alivePlayers.filter((p: Player) => game.revoteCandidates!.includes(p.id));
    }

    const rows = Messages.createButtonRows(voteTargets, 'vote');
    if (!game.isRevote) {
        const passRow = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('vote_skip').setLabel(UI.vote.skipButton).setStyle(ButtonStyle.Secondary));
        const dictator = alivePlayers.find((p: Player) => p.role === '独裁者');
        if (dictator && !game.hasDictatorUsedPower) {
            passRow.addComponents(new ButtonBuilder().setCustomId('dictator_co').setLabel(UI.vote.dictatorButton).setStyle(ButtonStyle.Danger));
        }
        rows.push(passRow);
    }
    
    const voteTimeLimit = game.isRevote ? TIMING.revoteTimeLimit : TIMING.voteTimeLimit;
    const textMsg = fill(game.isRevote ? MSG.vote.revotePrompt : MSG.vote.prompt, { seconds: voteTimeLimit / 1000 });
    
    const votes: Record<string, string> = {};
    let votingFinished = false;

    const activeCollectors: any[] = [];
    game.players.filter((p: Player) => p.isNpc && p.alive).forEach((npc: any) => {
        if (game.isRevote && game.revoteCandidates) {
            votes[npc.id] = game.revoteCandidates![Math.floor(Math.random() * game.revoteCandidates!.length)];
            return;
        }
        const voteInfo = NPC.getNpcVoteTarget(npc, game);
        const targetId = typeof voteInfo === 'string' ? voteInfo : voteInfo.targetId;
        votes[npc.id] = targetId || 'skip';

        // ==========================================
        // ★ NPC独裁者の能力発動ロジック（性格・確率対応）
        // ==========================================
        if (npc.role === '独裁者' && !game.hasDictatorUsedPower && !game.isRevote && targetId !== 'skip') {
            const pTone = npc.personality || 'normal';
            
            // 性格によって発動確率を変える
            let useChance = 0.2; // 基本は20%の確率で発動
            if (pTone === 'aggressive' || pTone === 'joker') useChance = 0.6; // 好戦的・お調子者は60%でぶっぱなす
            if (pTone === 'gal') useChance = 0.5; // ギャルもノリで50%
            if (pTone === 'cautious') useChance = 0.05; // 慎重な性格は5%しか使わない

            if (Math.random() < useChance) {
                // 投票開始から数秒後に「突然」割り込む演出（2秒〜7秒後）
                setTimeout(async () => {
                    if (votingFinished) return; // すでに誰かが独裁を使っていたり、投票が終わっていたら何もしない
                    
                    game.hasDictatorUsedPower = true;
                    game.dictatorTarget = targetId;
                    const targetName = game.players.find((p: Player) => p.id === targetId)?.name || '不明';

                    // 性格に合わせた突然のCOセリフ
                    const coMsg = getDictatorCoMessage(pTone, targetName);

                    const announce = `🗡️ **${npc.name} が【独裁者】をCO！**\n${coMsg}`;
                    
                    if (game.dividedGroups && game.sectorAChannel && game.sectorBChannel) {
                        await Messages.safeSend(game.sectorAChannel, { content: announce }).catch(()=>{});
                        await Messages.safeSend(game.sectorBChannel, { content: announce }).catch(()=>{});
                    } else {
                        await Messages.safeSend(game.channel, { content: announce }).catch(()=>{});
                    }

                    // 🌟 追加：AIがCOを認識できるようにチャットログに記録する！
                    if (!game.chatLog) game.chatLog = [];
                    game.chatLog.push({ id: npc.id, name: npc.name, content: `(独裁者CO) ${coMsg}`, day: game.dayCount });
                    if (game.chatLog.length > 100) game.chatLog.shift();

                    // 全員の票をターゲットで上書き
                    alivePlayers.forEach((pl: Player) => { votes[pl.id] = targetId; }); 
                    activeCollectors.forEach(c => c.stop('dictator'));

                }, 2000 + Math.random() * 5000); 
            }
        }
    });
    let voteMsg: any = null, voteMsgA: any = null, voteMsgB: any = null;

    if (game.dividedGroups && game.sectorAChannel && game.sectorBChannel) {
        voteMsgA = await game.sectorAChannel.send({ content: textMsg, components: rows });
        voteMsgB = await game.sectorBChannel.send({ content: textMsg, components: rows });
        activeCollectors.push(voteMsgA.createMessageComponentCollector({ time: voteTimeLimit }));
        activeCollectors.push(voteMsgB.createMessageComponentCollector({ time: voteTimeLimit }));
    } else {
        voteMsg = await game.channel.send({ content: textMsg, components: rows });
        activeCollectors.push(voteMsg.createMessageComponentCollector({ time: voteTimeLimit }));
    }

    const aliveHumans = alivePlayers.filter((p: Player) => !p.isNpc).length;
    if (aliveHumans === 0) {
        setTimeout(() => activeCollectors.forEach(c => c.stop()), TIMING.npcVoteDelay);
    }

    let endedCollectors = 0;

    activeCollectors.forEach(collector => {
        trackCollector(game, collector);
        collector.on('collect', async (i: any) => { 
            if (i.replied || i.deferred) return; 

            if (i.customId === 'dictator_co') {
                const p = game.players.find((pl: Player) => pl.id === i.user.id);
                if (!p || p.role !== '独裁者') return i.reply({ content: MSG.vote.dictatorNoAuth, ephemeral: true });
                if (game.hasDictatorUsedPower) return i.reply({ content: MSG.vote.dictatorAlreadyUsed, ephemeral: true });
                
                const dTargets = alivePlayers.filter((pl: Player) => pl.id !== p.id);
                const btnRows = Messages.createButtonRows(dTargets, 'dictator_exec', ButtonStyle.Danger);
                
                const dictatorMsg = await i.reply({ 
                    content: MSG.vote.dictatorSelectPrompt, 
                    components: btnRows, ephemeral: true, fetchReply: true 
                });
                
                try {
                    const execI = await dictatorMsg.awaitMessageComponent({ filter: (int: any) => int.user.id === i.user.id, time: voteTimeLimit });
                    if (execI.customId.startsWith('dictator_exec_')) {
                        game.hasDictatorUsedPower = true;
                        game.dictatorTarget = execI.customId.replace('dictator_exec_', '');
                        const targetName = game.players.find((pl: Player) => pl.id === game.dictatorTarget)?.name || '不明';

                        // 🌟 追加：人間がCOした事実もチャンネルとログに流す！
                        const humanAnnounce = `🗡️ **${p.name} が【独裁者】をCOし、${targetName} を処刑します！**`;
                        Messages.safeSend(game.channel, { content: humanAnnounce }).catch(()=>{});

                        if (!game.chatLog) game.chatLog = [];
                        game.chatLog.push({ id: p.id, name: p.name, content: `(独裁者CO) 俺が独裁者だ！ ${targetName} を処刑する！`, day: game.dayCount });
                        if (game.chatLog.length > 100) game.chatLog.shift();

                        alivePlayers.forEach((pl: Player) => { votes[pl.id] = game.dictatorTarget as string; }); 
                        activeCollectors.forEach(c => c.stop('dictator'));
                        return execI.update({ content: MSG.vote.dictatorUsed, components: [] }).catch(()=>{});
                    }
                } catch (err) {}
                return;
            }
            
            if (!game.players.find((p: Player) => p.id === i.user.id && p.alive)) return i.reply({content: MSG.vote.deadVoteError, ephemeral:true});
            const targetId = i.customId.replace('vote_', '');
            const isChange = !!votes[i.user.id]; // 既に投票していたかチェック
            votes[i.user.id] = targetId;
            const targetName = targetId === 'skip' ? 'パス' : game.players.find((p: Player) => p.id === targetId)?.name || '不明';            
            
            const replyMsg = isChange ? `🔄 投票先を **${targetName}** に【変更】しました！` : fill(MSG.vote.voteConfirm, { target: targetName });
            i.reply({ content: replyMsg, ephemeral: true });       
            
            if (game.settings.autoFinishVoting) {
                const votedHumans = Object.keys(votes).filter(id => !game.players.find((p: Player) => p.id === id)?.isNpc).length; // ★修正: ?.isNpc に変更
                if (votedHumans >= aliveHumans) activeCollectors.forEach(c => c.stop());
            }
        });

        collector.on('end', async () => { 
            endedCollectors++;
            if (endedCollectors >= activeCollectors.length && !votingFinished) {
                votingFinished = true; 
                
                if (voteMsg) voteMsg.edit({ components: [] }).catch(()=>{});
                if (voteMsgA) voteMsgA.edit({ components: [] }).catch(()=>{});
                if (voteMsgB) voteMsgB.edit({ components: [] }).catch(()=>{});

                if (game.dividedGroups && game.sectorAChannel && game.sectorBChannel) {
                    try {
                        await game.sectorAChannel.delete('分断解除').catch(()=>{});
                        await game.sectorBChannel.delete('分断解除').catch(()=>{});
                        await game.channel.permissionOverwrites.edit(game.channel.guild.roles.everyone, { ViewChannel: true });
                        
                        game.sectorAChannel = undefined; game.sectorBChannel = undefined; game.dividedGroups = null;

                        let syncText = MSG.morning.sectorMerge;
                        let syncInfos = [];
                        const deadToday = game.players.filter(p => !p.alive && p.deathDay === (game.dayCount - 1) && p.deathReason === 'kill');
                        if (deadToday.length > 0) {
                            syncInfos.push(fill(MSG.morning.sectorDeadSync, { names: deadToday.map(p => p.name).join('** と **') }));
                        } else {
                            syncInfos.push(MSG.morning.sectorPeaceSync);
                        }

                        if (game.coronerReport) syncInfos.push(game.coronerReport);
                        syncText += syncInfos.join('\n\n');
                        
                        await Messages.safeSend(game.channel, { content: syncText });
                        await new Promise(resolve => setTimeout(resolve, TIMING.sectorMergeDelay));
                    } catch (e) { console.error("合流エラー:", e); }
                }
                tallyVotes(game, votes); 
            }
        });
    });
}

async function tallyVotes(game: GameState, votes: Record<string, string>) {
    let tally: Record<string, number> = {};
    if (!game.voteLog) game.voteLog = [];
    if (!game.timeline) game.timeline = []; 

    game.voteLog.push({ day: game.dayCount, votes: { ...votes } });
    game.timeline.push({ type: 'vote', day: game.dayCount, data: { ...votes } });

    Object.entries(votes).forEach(([voterId, targetId]) => {
        const voter = game.players.find((p: Player) => p.id === voterId);
        const voteWeight = (voter && voter.role === '市長') ? 2 : 1;
        tally[targetId] = (tally[targetId] || 0) + voteWeight;
    });

    let tallyMsg = '';
    const sorted = Object.entries(tally).sort(([, a], [, b]) => b - a);

    if (game.dictatorTarget) {
        const dictator = game.players.find((p: Player) => p.role === '独裁者');
        const target = game.players.find((p: Player) => p.id === game.dictatorTarget);
        const dText = fill(MSG.vote.dictatorExec, { dictator: dictator?.name || '', target: target?.name || '' });
        await Messages.safeSend(game.channel, { content: dText });
        game.history.push(`​🗡️ 独裁者CO: ${dictator?.name} が ${target?.name} を処刑`);
        game.timeline.push({ type: 'system', content: `​🗡️ 独裁者CO: ${dictator?.name} が ${target?.name} を処刑` });
        game.dictatorTarget = undefined;
    } else {
        if (game.settings.voteTransparency === 'anonymous') {
            sorted.forEach(([id, c]) => {
                const name = id === 'skip' ? 'パス' : game.players.find((p: Player) => p.id === id)?.name || '不明';
                tallyMsg += `・**${name}**: ${c}票\n`;
            });
        } else {
            sorted.forEach(([id, c]) => {
                const name = id === 'skip' ? 'パス' : game.players.find((p: Player) => p.id === id)?.name || '不明';
                const voters = Object.keys(votes).filter(vId => votes[vId] === id).map(vId => game.players.find((p: Player) => p.id === vId)?.name || '不明').join(', ');
                tallyMsg += `・**${name}**: ${c}票 (${voters})\n`;
            });
        }
        await Messages.safeSend(game.channel, { content: `${MSG.vote.tallyTitle}\n${tallyMsg.trim()}` });
    }

    if (sorted.length === 0 || sorted[0][0] === 'skip') {
        game.isRevote = false;
        await Messages.safeSend(game.channel, { content: MSG.vote.noExecution });
        game.history.push(`📅 ${game.dayCount}日目: 処刑なし`);
        game.timeline.push({ type: 'system', content: `📅 ${game.dayCount}日目: 処刑なし` });
        return startNightPhase(game);
    }
    
    const max = sorted[0][1];
    const candidates = sorted.filter(s => s[1] === max).map(s => s[0]);
    let executedId: string | undefined;

    if (candidates.length > 1) {
        if (game.settings.tieVoteHandling === 'revote' && !game.isRevote) {
            await Messages.safeSend(game.channel, { content: MSG.vote.tieRevote });
            game.isRevote = true; game.revoteCandidates = candidates;
            return startVotingPhase(game);
        } 
        else if (game.settings.tieVoteHandling === 'random' || (game.settings.tieVoteHandling === 'revote' && game.isRevote)) {
            executedId = candidates[Math.floor(Math.random() * candidates.length)];
            await Messages.safeSend(game.channel, { content: fill(MSG.vote.randomExecution, { name: game.players.find((p: Player)=>p.id===executedId)?.name || '' }) });
        } 
        else {
            await Messages.safeSend(game.channel, { content: MSG.vote.tieNoExecution });
            game.history.push(`📅 ${game.dayCount}日目: 処刑なし (同票)`);
            game.timeline.push({ type: 'system', content: `📅 ${game.dayCount}日目: 処刑なし (同票)` });
            game.isRevote = false;
            return startNightPhase(game);
        }
    } else {
        executedId = candidates[0];
    }

    game.isRevote = false; 

    if (executedId === 'skip') { 
        await Messages.safeSend(game.channel, { content: MSG.vote.noExecution });
        return startNightPhase(game); 
    }


    const executed = game.players.find((p: Player) => p.id === executedId)!;
    await Messages.safeSend(game.channel, { content: fill(MSG.vote.executedAnnounce, { name: executed.name }) });
    
    let execText = fill(MSG.vote.executedLog, { name: executed.name });

    if (game.settings.willMode) {
        if (!executed.isNpc) {
            await Messages.safeSend(game.channel, fill(MSG.vote.willRequest, { name: executed.name, seconds: TIMING.willTimeLimit / 1000 }));
            try { 
                const collected = await game.channel.awaitMessages({ filter: (m: any) => m.author.id === executed.id, max: 1, time: TIMING.willTimeLimit, errors: ['time'] });
                const willText = collected.first().content;
                execText += `\n> 「${willText}」`; 
                if (!game.chatLog) game.chatLog = [];
                game.chatLog.push({ id: executed.id, name: executed.name, content: `(遺言) ${willText}`, day: game.dayCount });
                game.timeline.push({ type: 'chat', day: game.dayCount, id: executed.id, name: executed.name, content: willText, isWill: true });
            } catch (e) { execText += `\n${MSG.vote.willSilence}`; }
        } else { 
            const npcWill = MSG.npcWills[Math.floor(Math.random() * MSG.npcWills.length)];
            execText += `\n> 「${npcWill}」`; 
            if (!game.chatLog) game.chatLog = [];
            game.chatLog.push({ id: executed.id, name: executed.name, content: `(遺言) ${npcWill}`, day: game.dayCount });
            game.timeline.push({ type: 'chat', day: game.dayCount, id: executed.id, name: executed.name, content: npcWill, isWill: true });
        }
    }

    await Messages.safeSend(game.channel, { content: execText });
    executed.alive = false;
    kickFromWolfChannel(game, executed.id);
    executed.deathDay = game.dayCount;
    executed.deathReason = 'execution';

    offerGhostBet(game, executed);

    if (executed.role === '猫又') {
        const targets = game.players.filter((p: Player) => p.alive && p.id !== executed.id);
        if (targets.length > 0) {
            const catVictim = targets[Math.floor(Math.random() * targets.length)];
            catVictim.alive = false;
            kickFromWolfChannel(game, catVictim.id);
            catVictim.deathDay = game.dayCount;
            catVictim.deathReason = 'kill';

            await Messages.safeSend(game.channel, { content: fill(MSG.vote.catCurse, { executed: executed.name, victim: catVictim.name }) });
            game.history.push(`🐈‍⬛ 道連れ(処刑): ${catVictim.name}`);
            game.timeline.push({ type: 'system', content: `🐈‍⬛ 道連れ(処刑): ${catVictim.name}` });
            offerGhostBet(game, catVictim);
            await checkLoversBond(game, catVictim);
            await checkNecromancerBond(game, catVictim);
        }
    }

    setSafeTimeout(game, async () => {
        if (executed.role === 'テルテル') { 
            const hCount = game.players.filter((p: Player) => !p.isNpc).length;
            const isRanked = game.settings.matchType === 'ranked' && hCount >= 2;
            
            // 💡 神が生きているかチェック！
            const god = game.players.find((p: Player) => p.role === '神' && p.alive);
            const finalWinner = god ? 'god' : 'teruteru'; // 神がいれば神が乗っ取る！
            let winMessage = god ? `${MSG.endGame.winText.god}\n(テルテルの勝利を神が乗っ取りました！)` : MSG.endGame.winText.teruteru;

            game.winnerTeam = finalWinner; finalizeTimeline(game, finalWinner); 
            game.resultSummary = buildResultSummary(game, finalWinner);

            let deltas: Record<string, number> = {};
            try {
                const res = await DB.saveGameResults(game, finalWinner, executed.name);
                if (res && res.deltas) deltas = res.deltas;
            } catch (e) { console.error("DB Save Error:", e); }
            
            const mvpData = calculateMVP(game, game.players, finalWinner);
            const aiComment = await AI.generateMvpComment(mvpData, game.history);
            
            let matchType = isRanked ? '🏆【ランクマッチ】' : '🔰【練習試合】';
            if (isRanked && Object.keys(deltas).length > 0) {
                matchType += '\n**📈 レート変動**\n';
                for (const [uid, delta] of Object.entries(deltas)) {
                    const p = game.players.find((pl: any) => pl.id === uid);
                    const d = delta as number; 
                    if (p) matchType += `▪ ${d > 0 ? '+' : ''}${d} pt : **${p.name}**\n`;
                }
            }
            matchType += `\n\n🏅 **MVP**: ${mvpData.name} **[${mvpData.role}]**\n「${aiComment}」`;
            return endGame(game, `${winMessage}\n${matchType}`); 
        }

        await checkLoversBond(game, executed);
        await checkNecromancerBond(game, executed);

        game.lastExecutionResult = { id: executed.id, isWolf: Roles.isActualWolf(executed.role as string) };

        game.history.push(`📅 ${game.dayCount}日目処刑: ${executed.name} (${executed.role})`);
        game.timeline.push({ type: 'execution', content: `📅 ${game.dayCount}日目処刑: ${executed.name} (${executed.role})` });

        if (await checkWin(game)) return;
        (game.timers = game.timers || []).push(setTimeout(() => startNightPhase(game), TIMING.executionToNightDelay));
    }, TIMING.afterExecutionDelay);
}

export function offerGhostBet(game: GameState, player: Player) {
    if (game.settings.matchType !== 'ranked' || player.isNpc || !player.user) return;
    player.betDeadline = Date.now() + TIMING.ghostBetDeadline * 1000;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`bet_villager_${player.betDeadline}`).setLabel(UI.vote.villagerBetButton).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bet_wolf_${player.betDeadline}`).setLabel(UI.vote.wolfBetButton).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`bet_other_${player.betDeadline}`).setLabel(UI.vote.otherBetButton).setStyle(ButtonStyle.Secondary)
    );

    Messages.safeDM(player.user, { 
        content: fill(MSG.ghostBet.prompt, { seconds: TIMING.ghostBetDeadline }),
        components: [row]
    }).then(success => {
        if (!success && game.channel) Messages.safeSend(game.channel, fill(MSG.ghostBet.dmFailed, { name: player.name }));
    });
}

export async function startNightPhase(game: GameState) {
    game.dayCount++; // 🌟 追加：夜が来るたびに日数を+1する（初日はここでDAY 1になる）
    game.actions = []; game.cursedTarget = null; 
    const nightTime = TIMING.nightTime;
    const isFirstNightPeace = game.dayCount === 1 && game.settings.firstNightPeace;

    if (!game.timeline) game.timeline = [];
    
    // 🌟 追加：タイムラインの開始記録を夜の最初に移動
    if (game.dayCount === 1) {
        game.timeline.push({ type: 'system', content: 'LINK START: リプレイデータを展開します...' });
    }

    game.timeline.push({ type: 'phase', content: `🌙 NIGHT ${game.dayCount}`, detail: '夜のフェーズ' });

    if (game.dayCount === 1) {
        const freemasons = game.players.filter((p: Player) => p.role === '共有者');
        if (freemasons.length >= 2) {
            const names = freemasons.map((p: Player) => p.name).join(' と ');
            freemasons.forEach((fm: any) => {
                if (!fm.isNpc) Messages.safeDM(fm.user, fill(MSG.roleActions.freemasonIntro, { names }));
            });
        }

        // ★追加: NPCキューピッドはここで恋人を選び、選ばれた人にDMを送る
        const cupid = game.players.find((p: Player) => p.role === 'キューピッド');
        if (cupid && cupid.isNpc && game.lovers.length === 0) {
            const idx = [...Array(game.players.length).keys()];
            const l1 = game.players[idx.splice(Math.floor(Math.random() * idx.length), 1)[0]];
            const l2 = game.players[idx.splice(Math.floor(Math.random() * idx.length), 1)[0]];
            game.lovers = [l1.id, l2.id];
            
            if (!l1.isNpc) Messages.safeDM(l1.user, `💘 **キューピッドの矢が刺さりました！**\nあなたは恋人に選ばれました！相手: **${l2.name}**`);
            if (!l2.isNpc) Messages.safeDM(l2.user, `💘 **キューピッドの矢が刺さりました！**\nあなたは恋人に選ばれました！相手: **${l1.name}**`);
        }
    }

    await Messages.safeSend(game.channel, { content: fill(MSG.night.nightStart, { seconds: nightTime / 1000 }) });

    let fugitiveTargetId: string | null = null, protectionTargetId: string | null = null, wolfVictimId: string | null = null;
    const aliveHumans = game.players.filter((p: Player) => !p.isNpc && p.alive);
    const dmCollectors: any[] = [];
    const wolfMainMessages: Record<string, any> = {};

    // =========================================================
    // ★ 狼チャットでの襲撃ボタン表示を廃止し、個チャ（DM）方式に変更
    // =========================================================
    const aliveHumanWolves = game.players.filter((p: Player) => Roles.isActualWolf(p.role as string) && p.alive && !p.isNpc);

    // ==========================================
    // ★ 1. ブリーフィング（AI廃止版）
    // ==========================================
    const npcWolves = game.players.filter((p: Player) => p.isNpc && (Roles.isActualWolf(p.role as string) || p.role === '分断者'));
    if (game.dayCount === 1 && game.wolfChannel) {
        let speakerName = "軍師";
        let personality = "normal";
        const rolesInGame = game.settings.roles.map((r: string) => Roles.ROLE_MAP[r] || r).join(', ');

        if (npcWolves.length > 0) {
            const speakerObj = npcWolves[Math.floor(Math.random() * npcWolves.length)];
            speakerName = speakerObj.name; 
            personality = speakerObj.personality || "normal";
        }
        
        const briefing = getWolfBriefing(personality, rolesInGame);
        Messages.safeSend(game.wolfChannel, `**${speakerName}**\n${briefing}`).catch(()=>{});
    }

    // ==========================================
    // ★ 2. NPC作戦指示盤（指示に対する「性格別」の返事！）
    // ==========================================
    if (npcWolves.length > 0 && game.wolfChannel) {
        const components: any[] = [];
        const aliveVillagers = game.players.filter((p: Player) => p.alive && !Roles.isActualWolf(p.role as string) && p.role !== '分断者');
        npcWolves.forEach(npc => {
            components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder().setCustomId(`npc_strat_${npc.id}`)
                    .setPlaceholder(`🎭 ${npc.name} の騙り方針を指示`)
                    .addOptions([
                        // ★修正：valueにアンダーバー入りのNPC_IDを混ぜないようにシンプル化
                        { label: '🔮 占い師を騙らせる', value: `claim_seer` },
                        { label: '👻 霊能者を騙らせる', value: `claim_medium` },
                        { label: '🥷 潜伏させる（騙らない）', value: `claim_hide` }
                    ])
            ));
            if (npc.role === '分断者' && aliveVillagers.length > 0 && !game.hasDividerUsedPower) {
                // ★修正：ターゲットのIDだけを渡す
                const divOptions = aliveVillagers.map((p: Player) => ({ label: `🌀 ${p.name} を隔離する`, value: `divide_${p.id}` }));
                components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                    new StringSelectMenuBuilder().setCustomId(`npc_div_${npc.id}`)
                        .setPlaceholder(`🌀 ${npc.name}(分断者) のターゲットを指示`)
                        .addOptions(divOptions.slice(0, 25))
                ));
            }
        });

        game.wolfChannel.send({ content: '⚙️ **【NPC作戦指示盤】**', components }).then((panelMsg: any) => {
            const collector = panelMsg.createMessageComponentCollector({ time: nightTime });
            trackCollector(game, collector);
            collector.on('collect', async (i: any) => {
                const val = i.values[0];
                
                // ★修正：NPC自身のIDは、メニューの「customId」から安全に取り出す
                const targetNpcId = i.customId.replace('npc_strat_', '').replace('npc_div_', '');
                const targetNpc = game.players.find((p: Player) => p.id === targetNpcId);
                
                if (!targetNpc) return i.reply({ content: 'NPCが見つかりません', ephemeral: true });

                const pTone = targetNpc.personality || 'normal';

                // 🌀 分断の指示への返事
                if (i.customId.startsWith('npc_div_')) {
                    // ▼▼ 追加: 過去の夜に使用済みの場合は弾く（今夜の選び直しは許可） ▼▼
                    const usedThisNight = game.actions.some((a: any) => a.type === 'divide' && a.from === targetNpcId);
                    if (game.hasDividerUsedPower && !usedThisNight) {
                        return i.reply({ content: '⚠️ 分断者の能力は既に別の夜に使用済みです（1ゲーム1回のみ）。', ephemeral: true });
                    }
                    // ▲▲ 追加 ▲▲

                    // ★修正：ターゲットのIDだけを綺麗に抜き出す
                    const targetPlayerId = val.replace('divide_', '');
                    const targetPlayer = game.players.find((p: Player) => p.id === targetPlayerId);
                    
                    game.hasDividerUsedPower = true;
                    game.actions = game.actions.filter((a: any) => !(a.type === 'divide' && a.from === targetNpcId));
                    game.actions.push({ type: 'divide', from: targetNpcId, target: targetPlayerId, result: true });
                    
                    const divReply = getDivideReply(pTone, targetPlayer?.name || '不明');

                    
                    return i.reply({ content: `**${targetNpc.name}**\n${divReply}`, ephemeral: false });
                }
                
                // 🎭 騙りの指示への返事
                targetNpc.isFakeSeer = false; targetNpc.isFakeMedium = false; targetNpc.isHiding = false;
                let roleName = '潜伏';
                // ★修正：シンプルな値で確実に判定する
                if (val === 'claim_seer') { targetNpc.isFakeSeer = true; roleName = '占い師'; }
                else if (val === 'claim_medium') { targetNpc.isFakeMedium = true; roleName = '霊能者'; }
                else if (val === 'claim_hide') { targetNpc.isHiding = true; }

                const replyMsg = getRoleClaimReply(pTone, roleName);

                return i.reply({ content: `**${targetNpc.name}**\n${replyMsg}`, ephemeral: false });
            });
        });
    }

    for (const p of aliveHumans) {
        let mainContent: string | null = null, fakeContent: string | null = null;
        let mainComponents: any[] = [], fakeComponents: any[] = [];
        const hasActed = (type: string) => game.actions.some((a: any) => a.type === type && a.from === p.id);

        if (p.role === '怪盗' && game.dayCount === 1) {
            if (!hasActed('steal')) {
                const targets = game.players.filter((pl: Player) => pl.id !== p.id);
                mainContent = MSG.night.roles.thief; mainComponents = Messages.createButtonRows(targets, 'thief', ButtonStyle.Primary);
            }
        }
        else if (p.role === 'キューピッド' && game.dayCount === 1) {
            if (game.lovers.length === 0) {
                const targets = game.players.filter((pl: Player) => true);
                mainContent = MSG.night.roles.cupid; 
                mainComponents = Messages.getCupidSelection(targets);
            }
        }
        else if (p.role === '死霊術師' && !game.hasNecromancerUsedPower) {
            const deadPlayers = game.players.filter((pl: Player) => !pl.alive);
            if (deadPlayers.length > 0) {
                mainContent = '🧟 **死霊術師の能力**\n今夜、死者の中から1人を選んで蘇生させることができます。（1ゲーム1回のみ）\n※あなたが死亡した場合、蘇生した者も道連れになります。';
                mainComponents = Messages.createButtonRows(deadPlayers, 'necro_revive', ButtonStyle.Success);
                mainComponents.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('necro_skip').setLabel('今は蘇生しない').setStyle(ButtonStyle.Secondary)));
            }
        }
        else if (p.role === '方位磁針' && !game.hasCompassUsedPower) {
            const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
            if (targets.length >= 2) {
                mainContent = '🧭 **方位磁針の能力**\nゲーム中に1度だけ、自分以外の2人を選んで、その2人が「同じ陣営」か「違う陣営」かを調べることができます。';
                mainComponents = [
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                        new StringSelectMenuBuilder().setCustomId('compass_select')
                            .setPlaceholder('調べる2人を選んでください')
                            .setMinValues(2)
                            .setMaxValues(2)
                            .addOptions(targets.map((t: Player) => ({ label: t.name, value: t.id })).slice(0, 25))
                    ),
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('compass_skip').setLabel('今は使わない').setStyle(ButtonStyle.Secondary)
                    )
                ];
            }
        }
        else if (p.role === '暗殺者') {
            const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
            if (targets.length > 0) {
                // 説明文の「ゲーム中に1度だけ」を修正
                mainContent = '🌒 **暗殺アクション**\n毎晩、誰かを暗殺できます。「村人陣営」を撃つとショックで自分も死ぬので注意。使わない場合は無視してください。';
                mainComponents = Messages.createButtonRows(targets, 'assassinate', ButtonStyle.Danger);
            }
        }
        else if (p.role === '純愛者' && game.dayCount === 1) {
            if (!game.devoteeTarget) {
                const targets = game.players.filter((pl: Player) => pl.id !== p.id);
                mainContent = MSG.night.roles.devotee; mainComponents = Messages.createButtonRows(targets, 'devotee', ButtonStyle.Danger);
            }
        }
        else if (p.role === '逃亡者') {
            if (!fugitiveTargetId) {
                const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
                mainContent = MSG.night.roles.fugitive; mainComponents = Messages.createButtonRows(targets, 'fugitive', ButtonStyle.Success);
            }
        }
        else if (Roles.isActualWolf(p.role as string)) {
            if (isFirstNightPeace) {
                mainContent = MSG.night.roles.wolfFirstNight;
            } else {
                // ★修正: 狼チャットの有無に関わらず、個チャに襲撃ボタンを表示する
                if (wolfVictimId) {
                    mainContent = MSG.night.roles.wolfAlreadyChosen || '🐺 すでに他の人狼が襲撃対象を決定しました。';
                } else {
                    const targets = game.players.filter((pl: Player) => !Roles.isActualWolf(pl.role as string) && pl.alive);
                    mainContent = MSG.night.roles.wolfKillPrompt || '🐺 今夜の襲撃対象を選んでください。（※先着順）'; 
                    mainComponents = Messages.createButtonRows(targets, 'kill', ButtonStyle.Danger);
                }
            }

            // 既存の偽占い処理
            const isSeerInSettings = game.settings.roles.includes('seer');
            const alreadyFakingMedium = game.evidence?.some((e: any) => e.from === p.id && ['medium_co', 'coroner_co'].includes(e.type));
            
            if (isSeerInSettings && !alreadyFakingMedium && !hasActed('divine')) {
                const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
                fakeContent = MSG.night.roles.fakeSeer; 
                fakeComponents = Messages.createNightActionRows(targets, 'divine', '偽占い');
            }
            
            // 🌟ここから下を追加：人狼用の偽霊媒UI
            const isMediumInSettings = game.settings.roles.includes('medium');
            const alreadyDivining = game.evidence?.some((e: any) => e.from === p.id && e.type === 'divine') || game.actions?.some((a: any) => a.from === p.id && a.type === 'divine');
            if (isMediumInSettings && game.dayCount >= 1 && !alreadyDivining && !hasActed('fake_medium')) {
                if (!fakeContent) fakeContent = '👻 **偽の霊能結果（騙り）**';
                const fakeMedRow = new ActionRowBuilder<ButtonBuilder>();
            
                if (game.lastExecutionResult) { // 処刑者がいる場合は白黒
                    const exId = game.lastExecutionResult.id;
                    const exP = game.players.find((pl: Player) => pl.id === exId);
                    fakeMedRow.addComponents(
                        new ButtonBuilder().setCustomId(`fakemedium_white_${exId}`).setLabel(`${exP?.name}を白出し`).setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`fakemedium_black_${exId}`).setLabel(`${exP?.name}を黒出し`).setStyle(ButtonStyle.Danger)
                    );
                } else { // 処刑者がいない場合はCOのみ
                    fakeMedRow.addComponents(
                        new ButtonBuilder().setCustomId('fakemedium_co_only').setLabel('霊能者としてCOする').setStyle(ButtonStyle.Primary)
                    );
                }
                fakeComponents.push(fakeMedRow);
            }
        }
        else if (p.role === '占い師') {
            if (!hasActed('divine')) {
                const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
                mainContent = MSG.night.roles.seer; mainComponents = Messages.createNightActionRows(targets, 'divine', '占い師');
            }
        }
        else if (p.role === '妖術師') {
            if (!hasActed('sorcery')) {
                const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
                mainContent = MSG.night.roles.sorcerer; mainComponents = Messages.createButtonRows(targets, 'sorcery', ButtonStyle.Secondary);
            }
            const isSeerInSettings = game.settings.roles.includes('seer');
            const alreadyFakingMedium = game.evidence?.some((e: any) => e.from === p.id && ['medium_co', 'coroner_co'].includes(e.type));
            
            // ▼ 元からある偽占いのコード
            if (isSeerInSettings && !alreadyFakingMedium && !hasActed('divine')) {
                const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
                fakeContent = MSG.night.roles.fakeSeer; 
                fakeComponents = Messages.createNightActionRows(targets, 'divine', '偽占い');
            }
            
            // ▼ ここから下を追加（人狼用の偽霊媒UI）
            const isMediumInSettings = game.settings.roles.includes('medium');
            const alreadyDivining = game.evidence?.some((e: any) => e.from === p.id && e.type === 'divine') || game.actions?.some((a: any) => a.from === p.id && a.type === 'divine');
            if (isMediumInSettings && game.dayCount >= 1 && !alreadyDivining && !hasActed('fake_medium')) {
                if (!fakeContent) fakeContent = '👻 **偽の霊能結果（騙り）**';
                else fakeContent += '\n\n👻 **偽の霊能結果（騙り）**';
                const fakeMedRow = new ActionRowBuilder<ButtonBuilder>();
            
                if (game.lastExecutionResult) { // 処刑者がいる場合は白黒
                    const exId = game.lastExecutionResult.id;
                    const exP = game.players.find((pl: Player) => pl.id === exId);
                    fakeMedRow.addComponents(
                        new ButtonBuilder().setCustomId(`fakemedium_white_${exId}`).setLabel(`${exP?.name}を白出し`).setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`fakemedium_black_${exId}`).setLabel(`${exP?.name}を黒出し`).setStyle(ButtonStyle.Danger)
                    );
                } else { // 処刑者がいない場合はCOのみ
                    fakeMedRow.addComponents(
                        new ButtonBuilder().setCustomId('fakemedium_co_only').setLabel('霊能者としてCOする').setStyle(ButtonStyle.Primary)
                    );
                }
                fakeComponents.push(fakeMedRow);
            }
        }
        else if (p.role === '騎士') {
            if (!protectionTargetId) {
                const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id && (!game.settings.continuousGuard ? pl.id !== p.lastGuarded : true));
                if (targets.length > 0) {
                    mainContent = MSG.night.roles.guard; mainComponents = Messages.createButtonRows(targets, 'guard', ButtonStyle.Success);
                } else {
                    mainContent = '🛡️ 連続で守れる相手がいません…今夜は誰も守れません。';
                }
            }
        }
        else if (p.role === '分断者' && !game.hasDividerUsedPower && !hasActed('divide')) {
            const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
            mainContent = '🌀 **分断アクション**\n今夜、自分と同じ部屋に引き込みたいメンバーを1人選んでください。（残りのメンバーはランダムに2部屋に分けられます。1ゲーム1回のみ）';
            mainComponents = Messages.createButtonRows(targets, 'divider', ButtonStyle.Danger);
        }
        // 修正後
        else if (p.role === '霊能者') {
            if (game.dayCount >= 1) {
                // --- ここから追加 ---
                const hasResult = !!game.lastExecutionResult;
                let resultText = "【昨晩、処刑は行われませんでした】";
                if (hasResult) {
                    const exP = game.players.find(pl => pl.id === game.lastExecutionResult!.id);
                    const resStr = game.lastExecutionResult!.isWolf ? '人狼🐺' : '人間👤';
                    resultText = `昨晩処刑された **${exP?.name}** は **【${resStr}】** でした。`;
                }
                // --- ここまで追加 ---

                // mainContentの内容を書き換え
                mainContent = `👻 **霊能結果**\n${resultText}\n\n明日の朝、霊能者としてCOしますか？（選択しなければ自動的にCO/公表されます）`;
                
                mainComponents = [
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('strategy_co').setLabel('朝に公表する').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('strategy_hide').setLabel('潜伏する (公表しない)').setStyle(ButtonStyle.Secondary)
                    )
                ];
            }
        }
        else {
            // 既存のその他の偽占い処理
            const isSeerInSettings = game.settings.roles.includes('seer');
            const canFakeSeer = isSeerInSettings && ['狂人', '狂信者', '妖狐', 'テルテル'].includes(p.role as string);
            const alreadyFakingMedium = game.evidence?.some((e: any) => e.from === p.id && ['medium_co', 'coroner_co'].includes(e.type));
            
            if (canFakeSeer && !alreadyFakingMedium && !hasActed('divine')) {
                const targets = game.players.filter((pl: Player) => pl.alive && pl.id !== p.id);
                mainContent = MSG.night.roles.fakeSeer; 
                mainComponents = Messages.createNightActionRows(targets, 'divine', '偽占い');
            }
            
            // 🌟ここから下を追加：狂人などの偽霊媒UI
            const isMediumInSettings = game.settings.roles.includes('medium');
            const canFakeMedium = isMediumInSettings && ['狂人', '狂信者', '妖狐', 'テルテル'].includes(p.role as string);
            const alreadyDivining = game.evidence?.some((e: any) => e.from === p.id && e.type === 'divine') || game.actions?.some((a: any) => a.from === p.id && a.type === 'divine');

            if (canFakeMedium && game.dayCount >= 1 && !alreadyDivining && !hasActed('fake_medium')) { // 🌟 game.lastExecutionResult を削除
                if (!mainContent) mainContent = '👻 **偽の霊能結果（騙り）**\n明日の朝、霊能者として偽証しますか？';
                else mainContent += '\n\n👻 **偽の霊能結果（騙り）**\n霊能者として騙ることも可能です。';
            
                const fakeMedRow = new ActionRowBuilder<ButtonBuilder>();
            
                if (game.lastExecutionResult) {
                    const executedId = game.lastExecutionResult.id;
                    const executedPlayer = game.players.find((pl: Player) => pl.id === executedId);
                    fakeMedRow.addComponents(
                        new ButtonBuilder().setCustomId(`fakemedium_white_${executedId}`).setLabel(`${executedPlayer?.name} を白出し`).setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`fakemedium_black_${executedId}`).setLabel(`${executedPlayer?.name} を黒出し`).setStyle(ButtonStyle.Danger)
                    );
                } else {
                    fakeMedRow.addComponents(
                        new ButtonBuilder().setCustomId('fakemedium_co_only').setLabel('霊能者としてCOする').setStyle(ButtonStyle.Primary)
                    );
                }
                mainComponents.push(fakeMedRow);
            }
        }

        if (game.dayCount === 2) {
            const stolenAct = game.timeline.find((t: any) => t.type === 'action' && t.detail === 'steal' && t.target === p.id);
            if (stolenAct) {
                if (!mainContent) mainContent = MSG.system.thiefVictimNotice;
                else mainContent += `\n\n------------------------\n${MSG.system.thiefVictimNotice}`;
            }
        }

        try {
            if (!p.user) continue;
            if (mainContent || fakeContent) {
                const dmChannel = await p.user.createDM();
                const dmCollector = dmChannel.createMessageComponentCollector({ time: nightTime });
                dmCollectors.push(dmCollector);

                // 👇 変更：メッセージ送信時にオブジェクトを受け取り、人狼なら保存する
                let sentMainMsg: any = null;
                if (mainContent) {
                    sentMainMsg = await dmChannel.send({ content: mainContent, components: mainComponents });
                    if (Roles.isActualWolf(p.role as string) && !isFirstNightPeace) {
                        wolfMainMessages[p.id] = sentMainMsg;
                    }
                }
                
                if (fakeContent) await dmChannel.send({ content: fakeContent, components: fakeComponents });

                dmCollector.on('collect', async (i: any) => {
                    if (i.customId === 'strategy_hide') { 
                        p.hideStrategy = true; 
                        // 霊能者の場合はボタンを消し、それ以外（占い師など）は元のメニューを残してこっそり通知する
                        if (p.role === '霊能者') {
                            return i.update({ content: MSG.night.results.hideModeOn, components: [] }).catch(()=>{}); 
                        } else {
                            return i.reply({ content: (MSG.night.results.hideModeOn || '🌙 潜伏モードをONにしました。') + '\n(続けて夜のアクションを行ってください)', ephemeral: true }).catch(()=>{}); 
                        }
                    }
                    if (i.customId === 'strategy_co') { 
                        p.hideStrategy = false; 
                        if (p.role === '霊能者') {
                            return i.update({ content: MSG.night.results.coModeOn, components: [] }).catch(()=>{}); 
                        } else {
                            return i.reply({ content: (MSG.night.results.coModeOn || '☀️ 朝に公表するモードをONにしました。') + '\n(続けて夜のアクションを行ってください)', ephemeral: true }).catch(()=>{}); 
                        }
                    }
                    if (i.customId === 'compass_skip') {
                        return i.update({ content: '🌙 今夜は能力を温存します。', components: [] }).catch(()=>{});
                    }
                    if (i.customId === 'compass_select') {
                        const [id1, id2] = i.values;
                        const t1 = game.players.find((pl: Player) => pl.id === id1);
                        const t2 = game.players.find((pl: Player) => pl.id === id2);
                        if (!t1 || !t2) return i.reply({ content: 'プレイヤーが見つかりません。', ephemeral: true }).catch(()=>{});
                        
                        game.hasCompassUsedPower = true;
                        
                        // 陣営判定ロジック（恋人や純愛者も考慮）
                        const getTeam = (player: Player): string => {
                            if (game.lovers && game.lovers.includes(player.id)) return 'lovers';
                            if (player.role === '妖狐') return 'fox';
                            if (player.role === 'テルテル') return 'teruteru';
                            if (player.role === '純愛者' && game.devoteeTarget) {
                                const target = game.players.find((pl: Player) => pl.id === game.devoteeTarget);
                                if (target && target.id !== player.id) return getTeam(target);
                            }
                            return Roles.ROLE_CATALOG[player.role as string]?.team || 'villager';
                        };
                        
                        const isSameTeam = getTeam(t1) === getTeam(t2);
                        game.actions.push({ type: 'compass', from: p.id, target: `${id1}_${id2}`, result: isSameTeam });
                        
                        const resultText = isSameTeam ? '【同じ陣営】' : '【違う陣営】';
                        return i.update({ content: `🧭 **方位磁針の結果**\n**${t1.name}** と **${t2.name}** は ${resultText} です。`, components: [] }).catch(()=>{});
                    }
                    if (i.customId === 'necro_skip') { return i.update({ content: '🌙 今夜は死者を眠らせておきます。', components: [] }).catch(()=>{}); }
                    
                    if (i.customId.startsWith('fakemedium_')) {
                        game.actions = game.actions.filter((a: any) => !(a.type === 'fake_medium' && a.from === p.id));
                        
                        // 👇 新しく追加した「COのみ」ボタンの処理
                        if (i.customId === 'fakemedium_co_only') {
                            game.actions.push({ type: 'fake_medium', from: p.id, target: 'none', result: false });
                            return i.update({ content: `🎭 偽の霊能者としてCOするように設定しました。（明日の朝、公表されます）`, components: [] }).catch(()=>{});
                        } else {
                            // 既存の「白出し・黒出し」ボタンの処理
                            const isBlack = i.customId.includes('_black_');
                            const executedId = i.customId.replace('fakemedium_white_', '').replace('fakemedium_black_', '');
                            game.actions.push({ type: 'fake_medium', from: p.id, target: executedId, result: isBlack });
                            const reportedRole = isBlack ? '人狼🐺' : '人間👤';
                            return i.update({ content: `🎭 偽の霊能結果を **【${reportedRole}】** に設定しました。（明日の朝、公表されます）`, components: [] }).catch(()=>{});
                        }
                    }

                    if (i.customId.startsWith('fakeresult_')) {
                        const isBlack = i.customId.includes('black');
                        const targetId = i.customId.replace('fakeresult_white_', '').replace('fakeresult_black_', '');
                        const t = game.players.find((pl: Player) => pl.id === targetId);
                        if (t) {
                            game.actions.push({ type: 'divine', from: p.id, target: targetId, result: isBlack });
                            return i.update({ content: fill(MSG.night.results.fakeResult, { target: t.name, result: isBlack ? '人狼🐺' : '人間👤' }), components: [] }).catch(()=>{});
                        } else {
                            return i.reply({ content: MSG.night.results.errorTarget, ephemeral: true }).catch(()=>{});
                        }
                    }

                    // 修正後
                    const getTarget = (i: any) => {
                        const val = i.isStringSelectMenu?.() ? i.values[0] : i.customId;
                        // "kill_123456" などの形式から、最後の "_" 以降（ID部分）を抽出する
                        const parts = val.split('_');
                        const targetId = parts[parts.length - 1]; 
                        // もしNPCのIDが "npc_1" のようにアンダーバーを含む場合を考慮するなら、
                        // 以下のように具体的なプレフィックスを削除する方がより安全です。
                        
                        return game.players.find((pl: Player) => pl.id === targetId || val.endsWith(pl.id));
                    };
                    const target = getTarget(i);
                    if (!target) return;

                    if (i.customId.startsWith('thief_')) {
                        const stolenRole = target.role; target.role = '村人'; p.role = stolenRole;
                        game.actions.push({ type: 'steal', from: p.id, target: target.id, result: stolenRole });
                        await i.update({ content: fill(MSG.night.results.thiefSuccess, { target: target.name, role: stolenRole || '' }), components: [] }).catch(()=>{});
                    }
                    else if (i.customId.startsWith('necro_revive_')) {
                        game.hasNecromancerUsedPower = true;
                        game.necromancerTarget = target.id;
                        game.actions.push({ type: 'revive', from: p.id, target: target.id, result: true });
                        return i.update({ content: `🧟 **${target.name}** に魂を吹き込みました。（明日の朝、蘇生します）`, components: [] }).catch(()=>{});
                    }
                    else if (i.customId.startsWith('assassinate_')) {
                        game.hasAssassinUsedPower = true;
                        game.actions.push({ type: 'assassinate', from: p.id, target: target.id, result: true });
                        return i.update({ content: `🗡️ **${target.name}** を暗殺ターゲットに設定しました。明日の朝が楽しみですね…。`, components: [] }).catch(()=>{});
                    }
                    else if (i.customId.startsWith('devotee_')) {
                        game.devoteeTarget = target.id;
                        return i.update({ content: fill(MSG.night.results.devoteeSet, { target: target.name }), components: [] }).catch(()=>{});
                    }
                    else if (i.customId.startsWith('fugitive_')) {
                        fugitiveTargetId = target.id;
                        return i.update({ content: fill(MSG.night.results.fugitiveHide, { target: target.name }), components: [] }).catch(()=>{});
                    }
                    else if (i.customId.startsWith('divine_')) {
                        if (p.role === '占い師') {
                            if (target.role === '妖狐') game.cursedTarget = target.id;
                            // 白狼はfalse(白)、狼憑きはtrue(黒)を返し、それ以外は元々の判定に従う
                            const isWolfResult = target.role === '白狼' ? false : (target.role === '狼憑き' ? true : Roles.isActualWolf(target.role as string));
                            game.actions.push({ type: 'divine', from: p.id, target: target.id, result: isWolfResult });
                            return i.update({ content: fill(MSG.night.results.seerResult, { target: target.name, result: isWolfResult ? '人狼🐺' : '人間👤' }), components: [] }).catch(()=>{});
                        } else {
                            return i.update({ content: fill(MSG.night.results.fakeSeerChoose, { target: target.name }), components: Messages.createFakeResultRows(target.id, target.name) }).catch(()=>{});
                        }
                    }
                    else if (i.customId.startsWith('sorcery_')) {
                        game.actions.push({ type: 'sorcery', from: p.id, target: target.id, result: target.role });
                        return i.update({ content: fill(MSG.night.results.sorceryResult, { target: target.name, role: target.role || '' }), components: [] }).catch(()=>{});
                    }
                    else if (i.customId.startsWith('guard_')) {
                        protectionTargetId = target.id;
                        return i.update({ content: fill(MSG.night.results.guardSet, { target: target.name }), components: [] }).catch(()=>{});
                    }
                    else if (i.customId.startsWith('kill_')) {
                        if (wolfVictimId) return i.update({ content: '🐺 すでに他の人狼が対象を決定済みです。', components: [] }).catch(()=>{});
                        wolfVictimId = target.id;
                        
                        // 狼チャットがあるなら、そちらにも誰を選んだか通知してあげる
                        if (game.wolfChannel) {
                            Messages.safeSend(game.wolfChannel, `🐺 **${p.name}** が今夜の襲撃対象を **${target.name}** に決定した！`);
                        }

                        // 👇 追加：他の人間人狼のDM画面のボタンを遠隔で消し、テキストを更新する！
                        for (const [wId, wMsg] of Object.entries(wolfMainMessages)) {
                            if (wId !== p.id && wMsg && typeof wMsg.edit === 'function') {
                                wMsg.edit({ 
                                    content: `🐺 仲間の **${p.name}** が **${target.name}** を襲撃対象に決定しました！`, 
                                    components: [] 
                                }).catch(() => {});
                            }
                        }

                        // 👇 変更：自分が押したボタンの画面の更新
                        return i.update({ content: `🐺 あなたが **${target.name}** を襲撃対象に設定しました。`, components: [] }).catch(()=>{});
                    }
                    else if (i.customId.startsWith('divider_')) {
                        game.hasDividerUsedPower = true;
                        game.actions.push({ type: 'divide', from: p.id, target: target.id, result: true });
                        if (game.wolfChannel) Messages.safeSend(game.wolfChannel, fill(MSG.wolfChat.dividerAlert, { divider: p.name, target: target.name }));
                        return i.update({ content: fill(MSG.night.results.dividerSet, { target: target.name }), components: [] }).catch(()=>{});
                    }
                });
            }
        } catch (e) {
            console.error("Night DM Error for", p.name, e);
            Messages.safeSend(game.channel, fill(MSG.system.dmFailed, { name: p.name }));
        }
    }

    (game.timers = game.timers || []).push(setTimeout(async () => {
        dmCollectors.forEach(c => c.stop());
        let extraVictims: string[] = [];

        // ▼ 各役職の生存者を検索
        const thief = game.players.find((p: Player) => p.role === '怪盗' && p.alive);
        const cupid = game.players.find((p: Player) => p.role === 'キューピッド' && p.alive);
        const devotee = game.players.find((p: Player) => p.role === '純愛者' && p.alive);
        const fugitive = game.players.find((p: Player) => p.role === '逃亡者' && p.alive);
        const wolves = game.players.filter((p: Player) => Roles.isActualWolf(p.role as string) && p.alive);
        const seer = game.players.find((p: Player) => p.role === '占い師' && p.alive);
        const sorcerer = game.players.find((p: Player) => p.role === '妖術師' && p.alive);
        const guard = game.players.find((p: Player) => p.role === '騎士' && p.alive);
        const necromancer = game.players.find((p: Player) => p.role === '死霊術師' && p.alive);
        const divider = game.players.find((p: Player) => p.role === '分断者' && p.alive);
        const compass = game.players.find((p: Player) => p.role === '方位磁針' && p.alive);
        
        const targets = game.players.filter((p: Player) => !Roles.isActualWolf(p.role as string) && p.alive);

        // 🗡️ 暗殺者の処理
        const assassinateAct = game.actions.find((a: any) => a.type === 'assassinate');
        if (assassinateAct) {
            const assassinId = assassinateAct.from;
            const aTargetId = assassinateAct.target;
            const aTarget = game.players.find((p: Player) => p.id === aTargetId);
            
            if (aTarget && aTarget.alive) {
                extraVictims.push(aTarget.id); // ターゲットは問答無用で死ぬ（騎士の護衛も貫通）
                const targetTeam = Roles.ROLE_CATALOG[aTarget.role as string]?.team;
                
                // 村人陣営を撃ってしまったらショックで自殺
                if (targetTeam === 'villager') {
                    extraVictims.push(assassinId);
                    assassinateAct.result = 'suicide'; // ログ用
                } else {
                    assassinateAct.result = 'success'; // ログ用
                }
            }
        }

        if (game.dayCount === 1) {
            if (thief) {
                const acted = game.actions.some((a: any) => a.type === 'steal' && a.from === thief.id);
                if (!acted && targets.length > 0) {
                    const t = targets[Math.floor(Math.random() * targets.length)];
                    const stolenRole = t.role; t.role = '村人'; thief.role = stolenRole;
                    game.actions.push({ type: 'steal', from: thief.id, target: t.id, result: stolenRole });
                    if (!thief.isNpc) Messages.safeDM(thief.user, fill(MSG.night.forced.thief, { target: t.name, role: stolenRole || '' }));
                }
            }
            if (cupid && game.lovers.length === 0) {
                const idx = [...Array(game.players.length).keys()];
                const l1 = game.players[idx.splice(Math.floor(Math.random() * idx.length), 1)[0]];
                const l2 = game.players[idx.splice(Math.floor(Math.random() * idx.length), 1)[0]];
                game.lovers = [l1.id, l2.id];
                if (!cupid.isNpc) Messages.safeDM(cupid.user, fill(MSG.night.forced.cupid, { l1: l1.name, l2: l2.name }));
                
                if (!l1.isNpc) Messages.safeDM(l1.user, `💘 **キューピッドの矢が刺さりました！**\nあなたは恋人に選ばれました！相手: **${l2.name}**`);
                if (!l2.isNpc) Messages.safeDM(l2.user, `💘 **キューピッドの矢が刺さりました！**\nあなたは恋人に選ばれました！相手: **${l1.name}**`);
            }
            if (devotee && !game.devoteeTarget) {
                const dTargets = game.players.filter((p: Player) => p.id !== devotee.id);
                if (dTargets.length > 0) {
                    game.devoteeTarget = dTargets[Math.floor(Math.random() * dTargets.length)].id;
                }
            }
        }

        if (fugitive && fugitive.alive && !fugitiveTargetId) {
            let fTargets = game.players.filter((p: Player) => p.alive && p.id !== fugitive.id);
            if (fTargets.length > 0) {
                // 💡 逃亡者の賢いロジック：自分が「白」だと知っている相手を優先して逃げ込む
                if (fugitive.isNpc) {
                    const knownWhites = game.evidence.filter((e: any) => e.type === 'divine' && e.result === false && e.visible).map((e: any) => e.target);
                    const safeTargets = fTargets.filter(p => knownWhites.includes(p.id));
                    if (safeTargets.length > 0) fTargets = safeTargets;
                }
                fugitiveTargetId = fTargets[Math.floor(Math.random() * fTargets.length)].id;
                if (!fugitive.isNpc) Messages.safeDM(fugitive.user, fill(MSG.night.forced.fugitive, { target: game.players.find((p:any)=>p.id===fugitiveTargetId)?.name || '' }));
            }
        }

        if (seer && seer.alive && !game.actions.some((a: any) => a.type === 'divine' && a.from === seer.id)) {
            let sTargets = game.players.filter((p: Player) => p.alive && p.id !== seer.id);
            if (sTargets.length > 0) {
                // 💡 占い師の賢いロジック：過去に自分が占った人は二度占わない
                if (seer.isNpc) {
                    const myHistory = game.evidence.filter((e: any) => e.type === 'divine' && e.from === seer.id).map((e: any) => e.target);
                    const unsearched = sTargets.filter(p => !myHistory.includes(p.id));
                    if (unsearched.length > 0) sTargets = unsearched;
                }
                const t = sTargets[Math.floor(Math.random() * sTargets.length)];
                if (t.role === '妖狐') game.cursedTarget = t.id;
                const isWolfResult = t.role === '白狼' ? false : (t.role === '狼憑き' ? true : Roles.isActualWolf(t.role as string));
                game.actions.push({ type: 'divine', from: seer.id, target: t.id, result: isWolfResult });
                if (!seer.isNpc) Messages.safeDM(seer.user, fill(MSG.night.forced.seer, { target: t.name, result: isWolfResult ? '人狼🐺' : '人間👤' }));
            }
        }

        if (sorcerer && sorcerer.alive && !game.actions.some((a: any) => a.type === 'sorcery' && a.from === sorcerer.id)) {
            const sTargets = game.players.filter((p: Player) => p.alive && p.id !== sorcerer.id);
            if (sTargets.length > 0) {
                const t = sTargets[Math.floor(Math.random() * sTargets.length)];
                game.actions.push({ type: 'sorcery', from: sorcerer.id, target: t.id, result: t.role });
                if (!sorcerer.isNpc) Messages.safeDM(sorcerer.user, fill(MSG.night.forced.sorcery, { target: t.name, role: t.role || '' }));
            }
        }

        if (guard && guard.alive) {
            if (!protectionTargetId) {
                let gTargets = game.players.filter((p: Player) => p.alive && p.id !== guard.id && (!game.settings.continuousGuard ? p.id !== guard.lastGuarded : true));
                if (gTargets.length > 0) {
                    // 💡 騎士の賢いロジック：COしている「占い師」や「霊能者」を優先して守る
                    if (guard.isNpc) {
                        const coPlayers = game.evidence.filter((e: any) => e.visible && ['divine', 'medium_co'].includes(e.type)).map((e: any) => e.from);
                        const vipTargets = gTargets.filter(p => coPlayers.includes(p.id));
                        if (vipTargets.length > 0) gTargets = vipTargets;
                    }
                    protectionTargetId = gTargets[Math.floor(Math.random() * gTargets.length)].id;
                    if (!guard.isNpc) Messages.safeDM(guard.user, fill(MSG.night.forced.guard, { target: game.players.find((p: Player)=>p.id===protectionTargetId)?.name || '' }));
                }
            }
            guard.lastGuarded = protectionTargetId;
        }

        // 💡 死霊術師の自動発動ロジック
        if (necromancer && necromancer.alive && necromancer.isNpc && !game.hasNecromancerUsedPower) {
            const deadPlayers = game.players.filter((p: Player) => !p.alive);
            // 2日目以降で死者がおり、かつ30%の確率で自動蘇生を発動する
            if (deadPlayers.length > 0 && game.dayCount >= 2 && Math.random() < 0.3) {
                game.hasNecromancerUsedPower = true;
                const target = deadPlayers[Math.floor(Math.random() * deadPlayers.length)];
                game.necromancerTarget = target.id;
                game.actions.push({ type: 'revive', from: necromancer.id, target: target.id, result: true });
            }
        }

        // 💡 方位磁針の自動発動ロジック
        if (compass && compass.alive && compass.isNpc && !game.hasCompassUsedPower) {
            const cTargets = game.players.filter((p: Player) => p.alive && p.id !== compass.id);
            // 2日目以降で50%の確率で発動、または残り人数が少なければ発動
            if (cTargets.length >= 2 && (game.dayCount >= 2 && Math.random() < 0.5)) { 
                game.hasCompassUsedPower = true;
                const t1 = cTargets.splice(Math.floor(Math.random() * cTargets.length), 1)[0];
                const t2 = cTargets.splice(Math.floor(Math.random() * cTargets.length), 1)[0];
                
                const getTeam = (player: Player): string => {
                    if (game.lovers && game.lovers.includes(player.id)) return 'lovers';
                    if (player.role === '妖狐') return 'fox';
                    if (player.role === 'テルテル') return 'teruteru';
                    if (player.role === '純愛者' && game.devoteeTarget) {
                        const target = game.players.find((pl: Player) => pl.id === game.devoteeTarget);
                        if (target && target.id !== player.id) return getTeam(target);
                    }
                    return Roles.ROLE_CATALOG[player.role as string]?.team || 'villager';
                };
                
                const isSameTeam = getTeam(t1) === getTeam(t2);
                game.actions.push({ type: 'compass', from: compass.id, target: `${t1.id}_${t2.id}`, result: isSameTeam });
            }
        }


        // 💡 分断者の自動発動ロジック
        if (divider && divider.alive && divider.isNpc && !game.hasDividerUsedPower && !game.actions.some((a: any) => a.type === 'divide')) {
            const aliveVillagers = game.players.filter((p: Player) => p.alive && p.id !== divider.id && !Roles.isActualWolf(p.role as string));
            // 2日目以降、指示がなくても30%の確率で勝手に分断して村を荒らす
            if (aliveVillagers.length > 0 && game.dayCount >= 2 && Math.random() < 0.3) {
                game.hasDividerUsedPower = true;
                const target = aliveVillagers[Math.floor(Math.random() * aliveVillagers.length)];
                game.actions.push({ type: 'divide', from: divider.id, target: target.id, result: true });
            }
        }

        const humanWolves = wolves.filter((w: any) => !w.isNpc);
        if (!wolfVictimId && wolves.length > 0 && !isFirstNightPeace && targets.length > 0) {
            wolfVictimId = targets[Math.floor(Math.random() * targets.length)].id;
            const v = game.players.find((p: Player) => p.id === wolfVictimId);
            humanWolves.forEach((w: any) => { Messages.safeDM(w.user, fill(MSG.night.forced.kill, { target: v?.name || '' })); });
        }

        let guardSuccess = (protectionTargetId !== null && protectionTargetId === wolfVictimId);
        const intendedWolfVictimId = wolfVictimId; // ★追加: タイムライン記録用に元々のターゲットを保持

        if (wolfVictimId) {
            const v = game.players.find((p: Player) => p.id === wolfVictimId);
            if (v && v.role === '妖狐') wolfVictimId = null;
            // --- ここから追加 ---
            if (v && v.role === '神') wolfVictimId = null; // 神も襲撃を無効化する
            // --- ここまで追加 ---
            if (v && Roles.isActualWolf(v.role as string)) wolfVictimId = null;
        }
        if (guardSuccess) wolfVictimId = null;

        if (wolfVictimId) {
            const v = game.players.find((p: Player) => p.id === wolfVictimId);
            if (v && v.role === '呪われた村人') {
                wolfVictimId = null; // 襲撃を無効化（死なない）
                v.role = '人狼'; // 役職を人狼で上書きする！
                
                game.history.push(`🧟 呪い発動: ${v.name} が人狼に変化しました`);
                game.timeline.push({ type: 'system', day: game.dayCount, content: `🧟 呪い発動: ${v.name} が人狼に変化しました` });

                if (!v.isNpc) {
                    Messages.safeDM(v.user, "🐺 **恐ろしい呪いが発動しました…**\nあなたは昨晩、人狼に襲撃されましたが、死ぬ代わりに**【人狼】**に変化しました！今後は人狼陣営として勝利を目指してください。").catch(()=>{});
                }
                
                // 狼の隠れ家チャンネルがあれば、新しい仲間として招待する
                if (game.wolfChannel && !v.isNpc) {
                    try {
                        game.wolfChannel.permissionOverwrites.create(v.id, { ViewChannel: true, SendMessages: true });
                        Messages.safeSend(game.wolfChannel, `🐺 **新たな仲間が加わった！**\n呪いにより、${v.name} が人狼に変化しました！歓迎してやってください。`);
                    } catch(e) { console.error('呪われた村人の狼チャット追加エラー:', e); }
                }
            }
        }

        if (fugitive && fugitive.alive && fugitiveTargetId) {
            const target = game.players.find((p: Player) => p.id === fugitiveTargetId);
            if (target && Roles.isActualWolf(target.role as string)) extraVictims.push(fugitive.id);
            else if (wolfVictimId === fugitiveTargetId) extraVictims.push(fugitive.id);
            if (wolfVictimId === fugitive.id) wolfVictimId = null; 
        }

        game.players.forEach((p: Player) => {
            if (p.role === 'タフガイ' && p.alive) {
                if (p.fatalWound) extraVictims.push(p.id);
                else if (wolfVictimId === p.id) { p.fatalWound = true; wolfVictimId = null; }
            }
        });

        game.actions.forEach(act => { game.timeline.push({ type: 'action', detail: act.type, day: game.dayCount, from: act.from, target: act.target, result: act.result }); });
        if (guard && guard.alive && protectionTargetId) game.timeline.push({ type: 'action', detail: 'guard', day: game.dayCount, from: guard.id, target: protectionTargetId, result: protectionTargetId === intendedWolfVictimId }); // ★修正: intendedWolfVictimId に変更
        if (intendedWolfVictimId) { // ★修正: intendedWolfVictimId に変更
            const wFrom = humanWolves.length > 0 ? humanWolves[0].id : (wolves.length > 0 ? wolves[0].id : 'Unknown');
            game.timeline.push({ type: 'action', detail: 'kill', day: game.dayCount, from: wFrom, target: intendedWolfVictimId, result: !guardSuccess }); // ★修正
        }
        if (fugitive && fugitive.alive && fugitiveTargetId) game.timeline.push({ type: 'action', detail: 'fugitive', day: game.dayCount, from: fugitive.id, target: fugitiveTargetId, result: true });
        
        startMorningPhase(game, wolfVictimId, guardSuccess, extraVictims);
    }, nightTime));
}

export async function startMorningPhase(game: GameState, victimId: string | null, guardSuccess: boolean, extraVictims: string[] = []) { 
    const divideAct = game.actions.find((a: any) => a.type === 'divide');
    if (divideAct && !game.dividedGroups) {
        const alivePlayers = game.players.filter((p: Player) => p.alive);
        const roomA = new Set<string>([divideAct.from, divideAct.target]);
        const others = alivePlayers.filter((p: Player) => !roomA.has(p.id)).sort(() => Math.random() - 0.5);
        
        const half = Math.floor(alivePlayers.length / 2);
        while (roomA.size < half && others.length > 0) roomA.add(others.pop()!.id);
        game.dividedGroups = { roomA: Array.from(roomA), roomB: others.map(p => p.id) };

        try {
            await game.channel.permissionOverwrites.edit(game.channel.guild.roles.everyone, { ViewChannel: false });
            const createSector = async (name: string, members: string[]) => {
                return await game.channel.guild.channels.create({
                    name: name, type: ChannelType.GuildText, parent: game.channel.parentId,
                    permissionOverwrites: [
                        { id: game.channel.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: game.channel.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                        ...members.filter(id => !id.startsWith('npc_')).map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))
                    ]
                });
            };

            game.sectorAChannel = await createSector('🌀セクターα', game.dividedGroups.roomA);
            game.sectorBChannel = await createSector('🌀セクターβ', game.dividedGroups.roomB);

            const getSectorMemberNames = (ids: string[]) => ids.map(id => {
                const p = game.players.find(pl => pl.id === id);
                return p ? (p.isNpc ? `${p.name}` : p.name) : '不明';
            }).join(', ');

            const namesA = getSectorMemberNames(game.dividedGroups.roomA);
            const namesB = getSectorMemberNames(game.dividedGroups.roomB);

            const mentionsA = game.dividedGroups.roomA.filter(id => !id.startsWith('npc_')).map(id => `<@${id}>`).join(' ');
            const mentionsB = game.dividedGroups.roomB.filter(id => !id.startsWith('npc_')).map(id => `<@${id}>`).join(' ');

            await Messages.safeSend(game.sectorAChannel, { content: fill(MSG.morning.sectorSplit, { mentions: mentionsA, names: namesA }) });
            await Messages.safeSend(game.sectorBChannel, { content: fill(MSG.morning.sectorSplit, { mentions: mentionsB, names: namesB }) });
            game.history.push(`🌀 分断発動: 村が2つのセクターに隔離された！`);
        } catch (e) { console.error("チャンネル分断エラー:", e); game.dividedGroups = null; }
    }

    let deadNames: string[] = [];
    let allVictimIds = new Set<string>();
    if (!game.timeline) game.timeline = []; 
    if (victimId) allVictimIds.add(victimId);
    extraVictims.forEach(id => allVictimIds.add(id));

    for (const vId of allVictimIds) {
        const v = game.players.find((p: Player) => p.id === vId);
        if (v && v.alive) { 
            v.alive = false; kickFromWolfChannel(game, v.id);
            v.deathDay = game.dayCount; v.deathReason = 'kill';
            deadNames.push(v.name);
            game.history.push(`🌑 死亡: ${v.name}`); 
            game.timeline.push({ type: 'death', day: game.dayCount, content: `🌑 死亡: ${v.name}` });
            offerGhostBet(game, v); await checkLoversBond(game, v);
            await checkNecromancerBond(game, v);

            if (v.role === '猫又' && vId === victimId) {
                const wolves = game.players.filter((p: Player) => Roles.isActualWolf(p.role as string) && p.alive);
                if (wolves.length > 0) {
                    const wolfVictim = wolves[Math.floor(Math.random() * wolves.length)];
                    wolfVictim.alive = false; wolfVictim.deathDay = game.dayCount; wolfVictim.deathReason = 'kill';
                    deadNames.push(wolfVictim.name);
                    game.history.push(`🐈‍⬛ 道連れ(襲撃): ${wolfVictim.name}`);
                    game.timeline.push({ type: 'death', day: game.dayCount, content: `🐈‍⬛ 道連れ(襲撃): ${wolfVictim.name}` });
                    offerGhostBet(game, wolfVictim); await checkLoversBond(game, wolfVictim);
                }
            }
        } 
    }

    if (game.cursedTarget) { 
        const c = game.players.find((p: Player) => p.id === game.cursedTarget);
        if (c && c.alive) { 
            c.alive = false; c.deathDay = game.dayCount; c.deathReason = 'sudden_death';
            deadNames.push(c.name); 
            game.history.push(`🌑 呪殺: ${c.name}`); 
            game.timeline.push({ type: 'death', day: game.dayCount, content: `🌑 呪殺: ${c.name}` });
            offerGhostBet(game, c); await checkLoversBond(game, c);
            await checkNecromancerBond(game, c);
        } 
    } 

    let morningTextA = `------------------------\n`;
    let morningTextB = `------------------------\n`;
    let victimsInA: string[] = []; let victimsInB: string[] = [];

    deadNames.forEach(dName => {
        const deadPlayer = game.players.find((p: Player) => p.name === dName);
        if (deadPlayer) {
            if (game.dividedGroups?.roomA.includes(deadPlayer.id)) victimsInA.push(dName);
            else if (game.dividedGroups?.roomB.includes(deadPlayer.id)) victimsInB.push(dName);
            else victimsInA.push(dName);
        }
    });

    if (game.dividedGroups) {
        morningTextA += victimsInA.length > 0 ? fill(MSG.morning.sectorVictimFound, { names: victimsInA.join('** と **') }) : MSG.morning.sectorNoVictim;
        morningTextB += victimsInB.length > 0 ? fill(MSG.morning.sectorVictimFound, { names: victimsInB.join('** と **') }) : MSG.morning.sectorNoVictim;
        await Messages.safeSend(game.sectorAChannel, { content: morningTextA });
        await Messages.safeSend(game.sectorBChannel, { content: morningTextB });
    } else {
        if (deadNames.length > 0) await Messages.safeSend(game.channel, { content: fill(MSG.morning.victimFound, { names: deadNames.join('** と **') }) });
        else await Messages.safeSend(game.channel, { content: guardSuccess ? MSG.morning.guardSuccess : MSG.morning.noVictim }); 
    }
    
    const coroner = game.players.find((p: Player) => p.role === '検死官' && p.alive);
    if (coroner && deadNames.length > 0) {
        // ★修正: 変数フォーマットエラーを回避するため直接文字列を構築
        let coronerReport = "🔍 **検死レポート**\n昨晩の死者の正体は以下の通りです：\n";
        deadNames.forEach(dName => {
            const deadPlayer = game.players.find((p: Player) => p.name === dName);
            if (deadPlayer) coronerReport += `▪ **${dName}** ➔ **【${deadPlayer.role}】**\n`;
        });
        game.coronerReport = coronerReport; 
        
        if (coroner.isNpc) {
            const delay = TIMING.coronerDelayBase + Math.random() * TIMING.coronerDelayRandom;
            setSafeTimeout(game, async () => {
                let targetCh = game.channel;
                if (game.dividedGroups) targetCh = game.dividedGroups.roomA.includes(coroner.id) ? game.sectorAChannel : game.sectorBChannel;
                await Messages.safeSend(targetCh, { content: fill(MSG.morning.coronerAnnounce, { name: coroner.name, report: coronerReport }) });
                if (!game.chatLog) game.chatLog = [];
                game.chatLog.push({ id: coroner.id, name: coroner.name, content: `検死結果公表\n\n${coronerReport}`, day: game.dayCount });
                game.timeline.push({ type: 'chat', day: game.dayCount, id: coroner.id, name: coroner.name, content: `検死結果公表\n\n${coronerReport}` });
                if (!game.evidence) game.evidence = [];
                game.evidence.push({ type: 'coroner_co', day: game.dayCount, from: coroner.id, target: 'all', result: true, visible: true });
            }, delay);
        } else {
            // ★修正: fallbackテキストを設定して安全に送信
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('coroner_publish').setLabel('朝に公表する').setStyle(ButtonStyle.Success));
            Messages.safeDM(coroner.user, { content: coronerReport, components: [row] });
        }
    }

    const isCoronerInSettings = game.settings.roles.includes('coroner');
    const fakers = game.players.filter((p: Player) => {
        if (!isCoronerInSettings) return false; 
        if (!['狂人', '狂信者', '妖狐', 'テルテル', '妖術師'].includes(p.role as string) && !Roles.isActualWolf(p.role as string)) return false;
        if (!p.alive || p.isNpc) return false;
        const alreadyDivining = game.actions?.some((a: any) => a.from === p.id && a.type === 'divine') || game.evidence?.some((e: any) => e.from === p.id && e.type === 'divine');
        const alreadyMedium = game.evidence?.some((e: any) => e.from === p.id && e.type === 'medium_co');
        return !(alreadyDivining || alreadyMedium);
    });

    if (fakers.length > 0 && deadNames.length > 0) {
        for (const faker of fakers) {
            const fakeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('fakecoroner_open_modal').setLabel(UI.night.fakeCoronerBtn).setStyle(ButtonStyle.Danger));
            Messages.safeDM(faker.user, { content: MSG.morning.fakeCoronerDm, components: [fakeRow] });
        }
    }

    const reviveAct = game.actions.find((a: any) => a.type === 'revive');
    if (reviveAct) {
        const revivedPlayer = game.players.find((p: Player) => p.id === reviveAct.target);
        if (revivedPlayer) {
            revivedPlayer.alive = true; revivedPlayer.deathDay = undefined; revivedPlayer.deathReason = undefined;
            const reviveMsg = `🧟 **死霊術師の秘術**\n死者の魂が呼び戻されました。**${revivedPlayer.name}** が蘇生し、今日から再び議論に参加します！`;
            if (game.dividedGroups) {
                await Messages.safeSend(game.sectorAChannel, { content: reviveMsg });
                await Messages.safeSend(game.sectorBChannel, { content: reviveMsg });
            } else { await Messages.safeSend(game.channel, { content: reviveMsg }); }
            game.history.push(`💀 蘇生: ${revivedPlayer.name} (死霊術師の秘術)`);
            game.timeline.push({ type: 'system', content: `💀 蘇生: ${revivedPlayer.name} (死霊術師の秘術)` });
        }
    }
    
    (game.timers = game.timers || []).push(setTimeout(async () => { if (await checkWin(game)) return; startDayPhase(game); }, TIMING.morningToDayDelay));
}

async function checkLoversBond(game: GameState, deadPlayer: any) { 
    if (game.lovers && game.lovers.includes(deadPlayer.id)) { 
        const pId = game.lovers.find((id: string) => id !== deadPlayer.id);
        const p = game.players.find((pl: any) => pl.id === pId); 
        if (p && p.alive) { 
            p.alive = false; p.deathDay = game.dayCount; p.deathReason = 'sudden_death';
            await Messages.safeSend(game.channel, { content: `------------------------\n💔 **後追い自殺**\n恋人を失った **${p.name}** も命を絶ちました。` }); 
            game.history.push(`💔 後追い: ${p.name}`);
            if (!game.timeline) game.timeline = [];
            game.timeline.push({ type: 'death', day: game.dayCount, content: `💔 後追い: ${p.name}` }); 
            offerGhostBet(game, p);
        } 
    } 
}

async function checkNecromancerBond(game: GameState, deadPlayer: any) { 
    if (deadPlayer.role === '死霊術師' && game.necromancerTarget) { 
        const p = game.players.find((pl: any) => pl.id === game.necromancerTarget); 
        if (p && p.alive) { 
            p.alive = false; p.deathDay = game.dayCount; p.deathReason = 'sudden_death';
            await Messages.safeSend(game.channel, { content: `------------------------\n💀 **死者の道連れ**\n死霊術師が死亡したため、魔力で生かされていた **${p.name}** も土へと還りました。` }); 
            game.history.push(`💀 道連れ: ${p.name} (死霊術師の死)`);
            if (!game.timeline) game.timeline = [];
            game.timeline.push({ type: 'death', day: game.dayCount, content: `💀 道連れ: ${p.name}` }); 
            offerGhostBet(game, p);
            await checkLoversBond(game, p); // 恋人だった場合の連鎖チェック
        } 
    } 
}

function buildResultSummary(game: GameState, winner: string) {
    // プレイヤーのIDも受け取り、対象の陣営を正確に判定する
    const getTeam = (role: string = '', id: string = ''): string => {
        if (game.lovers && game.lovers.includes(id)) return "lovers";
        if (role === 'キューピッド' && winner === 'lovers') return "lovers";
        if (role === "妖狐") return "fox";
        if (role === "テルテル") return "teruteru";
        
        // 純愛者の場合、対象の陣営をコピーする
        if (role === "純愛者" && game.devoteeTarget) {
            const target = game.players.find((p: Player) => p.id === game.devoteeTarget);
            if (target && target.id !== id) {
                return getTeam(target.role, target.id); // 対象の陣営を再帰的に取得
            }
        }

        // ★エラー回避: 型を string | undefined にキャストして厳格チェックを抜ける
        const team = Roles.ROLE_CATALOG[role]?.team as string | undefined;
        if (team === 'wolf') return 'wolf';
        return "villager";
    };

    const summary = { total_days: game.dayCount, winner_team: winner, players: {} as Record<string, any> };
    // phase.ts の buildResultSummary 関数内のループ部分を修正

    game.players.forEach((p: Player) => {
        let team = getTeam(p.role);
        
        // 恋人本人、または「恋人陣営が勝った時のキューピッド」を恋人陣営として表示
        if (game.lovers && game.lovers.includes(p.id)) {
            team = "lovers"; 
        } else if (p.role === 'キューピッド' && winner === 'lovers') {
            team = "lovers";
        }

        summary.players[p.id] = { 
            name: p.name, 
            role: p.role || '不明', 
            team: team, 
            is_alive: !!p.alive, 
            death_day: p.alive ? null : (p.deathDay || null), 
            death_reason: p.alive ? null : (p.deathReason || null) 
        };
    });
    return summary;
}

async function checkWin(game: GameState) {
    const wolves = game.players.filter((p: Player) => Roles.isActualWolf(p.role as string) && p.alive).length;
    const humans = game.players.filter((p: Player) => !Roles.isActualWolf(p.role as string) && p.alive).length;
    const fox = game.players.find((p: Player) => p.role === '妖狐' && p.alive);
    const loversAlive = game.players.filter((p: Player) => p.alive && game.lovers && game.lovers.includes(p.id)).length === 2;
    
    let winner: string | null = null, message = '';
    
    if (wolves === 0) {
        if (fox) { winner = 'fox'; message = MSG.endGame.winText.fox; }
        else if (loversAlive) { winner = 'lovers'; message = MSG.endGame.winText.lovers; }
        else { winner = 'villager'; message = MSG.endGame.winText.villager; }
    } else if (wolves >= humans) {
        if (fox) { winner = 'fox'; message = MSG.endGame.winText.fox; }
        else if (loversAlive) { winner = 'lovers'; message = MSG.endGame.winText.lovers; }
        else { winner = 'wolf'; message = MSG.endGame.winText.wolf; }
    }
    
    if (winner) { 
        const aliveCount = game.players.filter((p: Player) => p.alive).length;
        const god = game.players.find((p: Player) => p.role === '神' && p.alive);

        // ▼▼ 神の勝利書き換えロジックを追加 ▼▼
        if (god) {
            if (['fox', 'lovers', 'teruteru'].includes(winner)) {
                winner = 'god';
                message = '✨ **神の単独勝利**\n第三陣営の勝利を退け、最後まで生き残った【神】が世界を掌握しました！';
            } else if (aliveCount <= 3) {
                message += '\n\n✨ **神の共存勝利**\n生存者が3人以下となったため、生き残った【神】も共に勝利を分かち合います！';
                game.godCoWin = true; // MVP計算のためのフラグ
            }
        }
        // ▲▲ ここまで ▲▲

        game.winnerTeam = winner;
        const humanCount = game.players.filter((p: Player) => !p.isNpc).length;
        const isRanked = game.settings.matchType === 'ranked' && humanCount >= 2;
        const mvpData = calculateMVP(game, game.players, winner);
        
        finalizeTimeline(game, winner);
        game.resultSummary = buildResultSummary(game, winner);

        let deltas: Record<string, number> = {};
        try { const res = await DB.saveGameResults(game, winner, mvpData.name); if (res && res.deltas) deltas = res.deltas; } catch (e) { console.error("DB Save Error:", e); }
        
        const aiComment = await AI.generateMvpComment(mvpData, game.history);
        let matchType = isRanked ? '🏆【ランクマッチ】' : '🔰【練習試合】';
        if (isRanked && Object.keys(deltas).length > 0) {
            matchType += '\n**📈 レート変動**\n';
            for (const [uid, delta] of Object.entries(deltas)) {
                const p = game.players.find((pl: any) => pl.id === uid);
                const d = delta as number; 
                if (p) {
                    let extraInfo = [];
                    if (p.name === mvpData.name) extraInfo.push('MVP');
                    if (p.alive) extraInfo.push('生存');
                    if (!p.alive && p.ghostBet) {
                        let hit = false;
                        if (p.ghostBet === 'villager' && winner === 'villager') hit = true;
                        if (p.ghostBet === 'wolf' && winner === 'wolf') hit = true;
                        if (p.ghostBet === 'other' && ['fox','lovers','teruteru'].includes(winner)) hit = true;
                        if (hit) extraInfo.push('賭的中');
                    }
                    const infoStr = extraInfo.length > 0 ? ` (${extraInfo.join('/')})` : '';
                    matchType += `▪ ${d > 0 ? '+' : ''}${d} pt : **${p.name}**${infoStr}\n`;
                }
            }
        }
        matchType += `\n\n🏅 **MVP**: ${mvpData.name} **[${mvpData.role}]**\n「${aiComment}」`;
        // ==========================================
        // ★ 人狼チャット部屋（隠れ家）の自動削除処理
        // ==========================================
        const wolfCh = game.wolfChannel;
        if (wolfCh) {
            // 🚨 【最重要】物理的に消えるより先に、Botの記憶から完全に切り離す！
            // これで次の試合が即座に始まっても、古い部屋を誤爆利用しなくなります。
            game.wolfChannel = undefined; 

            // エラーで止まらないように .catch() をつけて送信
            wolfCh.send('🚪 **この隠れ家はまもなく閉鎖されます。さらばだ。**').catch(()=>{});
            
            // 5秒後にチャンネル自体を削除
            setTimeout(() => {
                wolfCh.delete().catch((e: any) => console.error("隠れ家削除失敗", e));
            }, 5000); 
        }
        endGame(game, `${message}\n${matchType}`); 
        return true; 
    }
    return false;
}

function calculateMVP(game: GameState, players: any[], winningTeam: string) {
    if (!players || players.length === 0) return { name: 'Unknown', role: 'Unknown', reason: 'データなし' };
    let scores = players.map(p => ({ id: p.id, name: p.name, role: p.role, score: 0, reasons: [] as string[] }));

    // ヘルパー関数: プレイヤーの最終的な「判定用陣営」を取得する
    const getEffectiveTeam = (player: any): string => {
        if (game.lovers && game.lovers.includes(player.id)) return 'lovers';
        if (player.role === '妖狐') return 'fox';
        if (player.role === 'テルテル') return 'teruteru';
        
        // 純愛者の場合、対象の陣営をコピー
        if (player.role === '純愛者' && game.devoteeTarget) {
            const target = players.find(pl => pl.id === game.devoteeTarget);
            if (target && target.id !== player.id) return getEffectiveTeam(target);
        }

        // ★エラー回避: 型を string | undefined にキャストして厳格チェックを抜ける
        const team = Roles.ROLE_CATALOG[player.role as string]?.team as string | undefined;
        
        // 表記揺れ（village / villager）を統一
        if (team === 'village' || team === 'villager') return 'villager';
        return team || 'villager';
    };

    // 1. 勝利・生存ポイントの加算
    players.forEach((p, i) => {
        const playerTeam = getEffectiveTeam(p);
        // 勝利チームの表記揺れも考慮して判定
        const isWin = (playerTeam === winningTeam || (playerTeam === 'villager' && winningTeam === 'villager'));

        if (isWin) {
            scores[i].score += 100;
            if (p.alive) scores[i].score += 50;
            if (p.role === '純愛者') scores[i].reasons.push('愛する人の勝利に貢献');
        }
    });
    
    // 2. 占い師のアクションポイント
    if (game.actions) {
        game.actions.forEach((a: any) => {
            const idx = scores.findIndex(s => s.id === a.from);
            if (idx !== -1 && a.type === 'divine' && a.result === true) { 
                scores[idx].score += 30; 
                scores[idx].reasons.push('人狼発見'); 
            }
        });
    }

    // 3. 騎士の護衛成功ポイント（タイムライン参照）
    const guards = players.filter(p => p.role === '騎士');
    guards.forEach(guard => {
        const idx = scores.findIndex(s => s.id === guard.id);
        if (idx !== -1 && game.timeline) {
            const successCount = game.timeline.filter((t: any) => 
                t.type === 'action' && t.detail === 'guard' && t.from === guard.id && t.result === true
            ).length;

            if (successCount > 0) { 
                scores[idx].score += 40 * successCount; 
                scores[idx].reasons.push(`護衛成功x${successCount}`); 
            }
        }
    });

    // 4. 生き残った人狼へのポイント
    if (winningTeam === 'wolf') {
        players.filter(p => Roles.isActualWolf(p.role as string) && p.alive).forEach(w => {
            const idx = scores.findIndex(s => s.id === w.id);
            if(idx !== -1) { 
                scores[idx].score += 30; 
            }
        });
    }

    // 5. スコア順にソートしてMVPを決定
    scores.sort((a, b) => b.score - a.score);
    const mvp = scores[0];
    const reasonText = mvp.reasons.length > 0 ? mvp.reasons.join(', ') : '勝利への貢献';
    
    return { name: mvp.name, role: mvp.role, reason: reasonText };
}

function finalizeTimeline(game: any, winner: string) {
    if (game.timelineFinalized) return; 
    game.timelineFinalized = true;
    if (!game.timeline) game.timeline = [];

    let winName = MSG.endGame.winnerNames[winner as keyof typeof MSG.endGame.winnerNames] || MSG.endGame.winnerNames.draw;
    game.history.push(`🏆 勝敗: ${winName}の勝利！`);
    game.timeline.push({ type: 'winner', content: `${winName}の勝利！` });
    game.players.forEach((p: Player) => {
        game.history.push(`🎭 役職公開: ${p.name} <${p.id}> (${p.role})`);
        game.timeline.push({ type: 'system', content: `🎭 役職公開: ${p.name} <${p.id}> (${p.role})` });
    });
    game.timeline.push({ type: 'system', content: 'MATCH END: リプレイ終了' });
}

async function endGame(game: GameState, text: string) { 
    if (game.gayaInterval) { clearInterval(game.gayaInterval); game.gayaInterval = null; }
    if (game.timers && game.timers.length > 0) { game.timers.forEach(t => clearTimeout(t)); game.timers = []; }

    if (!game.timelineFinalized) {
        let winName = MSG.endGame.winnerNames[game.winnerTeam as keyof typeof MSG.endGame.winnerNames] || MSG.endGame.winnerNames.draw;
        game.history.push(`🏆 勝敗: ${winName}の勝利！`);
        game.timeline.push({ type: 'winner', content: `${winName}の勝利！` });
        game.players.forEach(p => { 
            game.history.push(`🎭 役職公開: ${p.name} <${p.id}> (${p.role})`); 
            game.timeline.push({ type: 'system', content: `🎭 役職公開: ${p.name} <${p.id}> (${p.role})` }); 
        });
        game.timeline.push({ type: 'system', content: 'MATCH END: リプレイ終了' });
        game.timelineFinalized = true;
    }

    try { await Messages.safeSend(game.channel, { content: "結果を表示します..." }); } catch (e) { console.error("EndGame MVP Send Error:", e); }

    (game.timers = game.timers || []).push(setTimeout(async () => { 
        let historyStr = "";
        
        for (let d = 1; d <= game.dayCount; d++) {
            let dailyLog = "";

            // ★ 1日目の冒頭に特殊な関係（恋人・純愛）を表示
            if (d === 1) {
                // 🌟 NPCの名前から 🤖 を消すヘルパー
                const getCleanName = (id: string) => {
                    const p = game.players.find(pl => pl.id === id);
                    if (!p) return '不明';
                    return p.isNpc ? p.name.replace('🤖', '') : p.name;
                };

                if (game.lovers && game.lovers.length === 2) {
                    const l1Name = getCleanName(game.lovers[0]);
                    const l2Name = getCleanName(game.lovers[1]);
                    dailyLog += `💘 **恋人成立** : **${l1Name}** & **${l2Name}**\n`;
                }
                if (game.devoteeTarget) {
                    const devoteePlayer = game.players.find(p => p.role === '純愛者');
                    const devoteeName = devoteePlayer ? getCleanName(devoteePlayer.id) : '純愛者';
                    const targetName = getCleanName(game.devoteeTarget);
                    // 🌟 ❤️‍🔥 を ♥️ に修正
                    dailyLog += `♥️ **純愛の対象** : **${devoteeName}** ➔ **${targetName}**\n`;
                }
            }
// その日の夜のアクション（タイムラインから抽出）
            const nightActions = game.timeline.filter((t: any) => t.day === d && t.type === 'action');
            nightActions.forEach((act: any) => {
                // 変更：役職を判定するために、プレイヤーオブジェクトそのものを取得する
                const fromPlayer = game.players.find((p: Player) => p.id === act.from);
                const targetPName = game.players.find((p: Player) => p.id === act.target)?.name || '不明';
                const fromPName = fromPlayer?.name || '不明';

                switch (act.detail) {
                    case 'divine': 
                        // ★ 狂人などのデタラメな占いは「偽占い」と暴露する！
                        const isFake = fromPlayer && fromPlayer.role !== '占い師';
                        dailyLog += `🔮 **${fromPName}** [${isFake ? '偽占い' : '占い'}] : **${targetPName}** ➔【${act.result ? '人狼●' : '人間○'}】\n`; 
                        break;
                    case 'guard':  dailyLog += `🛡️ **${fromPName}** [護衛] : **${targetPName}** ${act.result ? '(成功!)' : ''}\n`; break;
                    case 'kill':   dailyLog += `🐺 **${fromPName}** [襲撃] : **${targetPName}** ${act.result === false ? '(失敗)' : '(成功)'}\n`; break;
                    case 'sorcery': dailyLog += `👁️ **${fromPName}** [妖術] : **${targetPName}** ➔【${act.result}】\n`; break;
                    case 'steal':  dailyLog += `🎩 **${fromPName}** [怪盗] : **${targetPName}**\n`; break;
                    case 'divide': dailyLog += `🌀 **${fromPName}** [隔離] : **${targetPName}**\n`; break;
                    case 'revive': dailyLog += `🧟 **${fromPName}** [蘇生] : **${targetPName}**\n`; break;
                    case 'fugitive': dailyLog += `💨 **${fromPName}** [逃亡] : **${targetPName}**\n`; break;
                    case 'assassinate': 
                        const isSuicide = act.result === 'suicide';
                        dailyLog += `🌒 **${fromPName}** [暗殺] : **${targetPName}** ➔ ${isSuicide ? '💀(誤射)' : '💀(成功)'}\n`; 
                        break;
                    case 'compass':
                        const [id1, id2] = (act.target as string).split('_');
                        const n1 = game.players.find((p: Player) => p.id === id1)?.name || '不明';
                        const n2 = game.players.find((p: Player) => p.id === id2)?.name || '不明';
                        dailyLog += `🧭 **${fromPName}** [方位磁針] : **${n1}** & **${n2}** ➔ 【${act.result ? '同陣営' : '別陣営'}】\n`;
                        break;
                }
            });

            // その日の死亡・処刑イベント
            const deaths = game.timeline.filter((t: any) => t.day === d && (t.type === 'death' || t.type === 'execution'));
            deaths.forEach((evt: any) => {
                // そのままアイコン付きで表示する
                dailyLog += `${evt.content}\n`;
            });

            if (dailyLog) {
                historyStr += `\n**━━━ ${d}日目 ━━━**\n${dailyLog}`;
            }
        }

        if (historyStr.length > 1900) historyStr = "⚠️ 記録が長すぎるため、一部を省略しました。";

        // 🌟 アイコンを名前の先頭に付与・置換するヘルパー関数
        const getPlayerDisplayName = (p: Player) => {
            let prefix = p.isNpc ? '🤖' : '';
            if (game.lovers && game.lovers.includes(p.id)) {
                prefix = '💘';
            } else if (game.devoteeTarget === p.id) {
                prefix = '♥️';
            }
            
            let displayName = p.name;
            // NPCの場合、元々名前に含まれている🤖を消去して置換
            if (p.isNpc) {
                displayName = displayName.replace('🤖', '');
            }
            return `${prefix}**${displayName}** (${p.role})`;
        };

        // 生存者と死亡者を分けてリストアップする
        const alivePlayers = game.players.filter((p: Player) => p.alive).map(getPlayerDisplayName).join('\n') || 'なし';
        const deadPlayers = game.players.filter((p: Player) => !p.alive).map(getPlayerDisplayName).join('\n') || 'なし';

        // 勝利陣営に合わせてEmbedの色を変える（ちょっとしたこだわりポイント）
        let embedColor = 0xAAAAAA; // デフォルト（引き分けなど）はグレー
        if (game.winnerTeam === 'villager' || game.winnerTeam === 'god') embedColor = 0x3498DB; // 村人・神は青
        else if (game.winnerTeam === 'wolf') embedColor = 0xE74C3C; // 人狼は赤
        else if (game.winnerTeam === 'fox' || game.winnerTeam === 'lovers' || game.winnerTeam === 'teruteru') embedColor = 0x9B59B6; // 第三陣営は紫

        // 結果発表用のEmbedパネルを作成
        const resultEmbed = new EmbedBuilder()
            .setTitle('📘 【最終結果】')
            .setDescription(text) // text変数には勝敗テキストやMVP情報が入っています
            .setColor(embedColor)
            .addFields(
                { name: '🟢 生存者', value: alivePlayers, inline: true },
                { name: '💀 死亡者', value: deadPlayers, inline: true }
            );

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents( 
            new ButtonBuilder().setCustomId('game_rematch').setLabel(UI.vote.rematchButton).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('game_force_reset').setLabel(UI.vote.resetButton).setStyle(ButtonStyle.Secondary)
        );

        // 長い試合ログはテキストファイルとして組み立てる
        const buffer = Buffer.from(historyStr, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: `match_log_${game.dayCount}days.txt` });

        try {
            await game.channel.send({ 
                content: "お疲れ様でした！詳細な行動ログは添付ファイルを確認してください。",
                embeds: [resultEmbed], 
                files: [attachment],
                components: [row] 
            });

        } catch (e) {
            console.error("EndGame Send Error:", e);
            Messages.safeSend(game.channel, MSG.endGame.errorFallback);
        }
        
        game.state = 'idle';
        setTimeout(() => {
            try {
                const g = getGame(game.channel.id);
                if (g && g.state === 'idle') { resetGame(game.channel.id, true); }
            } catch(e) { console.error(e); }
        }, TIMING.idleGameCleanupHours * 60 * 60 * 1000);
    }, TIMING.endGameResultDelay)); 
}
