// src/state.ts
import { GameState } from './types';
import { User, TextChannel } from 'discord.js';

export const games = new Map<string, GameState>();

export function createEmptyState(): GameState {
    return {
        state: 'idle',
        channel: null,
        hostId: '',
        lobbyMessage: null,
        players: [],
        npcCount: 0,
        dayCount: 0,
        history: [],
        chatLog: [],
        timeline: [],
        voteLog: [],
        gayaInterval: null,
        lovers: [],
        settings: {
            wolfMode: 'auto',
            roles: ['seer'],
            discussionTime: 30,
            autoFinishVoting: true,
            gayaMode: false,
            willMode: false,
            firstNightPeace: false,
            voteTransparency: 'anonymous',
            tieVoteHandling: 'random',
            continuousGuard: false,
            matchType: 'ranked',
            mediumInfo: 'team',
            loquaciousMode: false,
        },
        actions: [],
        evidence: [],
        cursedTarget: null,
        lastExecutionResult: null,
        winnerTeam: null,
        timers: [],
        collectors: [],
        isRevote: false,
        revoteCandidates: [],
        settingsTab: 'basic',
        timelineFinalized: false,
        hasGodUsedPower: false,
        hasDictatorUsedPower: false,
        devoteeTarget: undefined,
        dictatorTarget: undefined,
        coronerReport: undefined,
        hasDividerUsedPower: false,
        dividedGroups: null,
        sectorAChannel: undefined,
        sectorBChannel: undefined,
        hasNecromancerUsedPower: false,
        necromancerTarget: undefined,
        godCoWin: false,
    };
}

/** ゲームが存在するかチェック（Mapを汚染しない） */
export function hasGame(channelId: string): boolean {
    return games.has(channelId);
}

/**
 * ゲームを取得する。存在しない場合は新規作成（既存の動作を維持）。
 * ゲームが存在しないチャンネルのメッセージ処理では hasGame() を先にチェックすること。
 */
export function getGame(channelId: string): GameState {
    if (!games.has(channelId)) {
        games.set(channelId, createEmptyState());
    }
    return games.get(channelId)!;
}

export function moveGameChannel(oldChannelId: string, newChannelId: string) {
    const game = games.get(oldChannelId);
    if (game) {
        games.set(newChannelId, game);
        games.delete(oldChannelId);
    }
}

export function findGameByUserId(userId: string): GameState | null {
    for (const [, g] of games.entries()) {
        if (g.state === 'playing' && !g.winnerTeam && g.players?.some(p => p.id === userId)) return g;
    }
    for (const [, g] of games.entries()) {
        if (g.state === 'recruiting' && g.players?.some(p => p.id === userId)) return g;
    }
    return null;
}

export function initGame(channel: any, author: User): GameState {
    resetGame(channel.id, true);
    const game = getGame(channel.id);
    game.channel = channel;
    game.hostId = author.id;
    game.state = 'recruiting';
    game.players = [{
        id: author.id, user: author, name: author.username, isNpc: false,
        settings: undefined
    }];
    return game;
}

/** 全タイマー・コレクター・インターバルを安全に停止する内部ヘルパー */
function stopAllGameTimers(game: GameState): void {
    // タイマーを全停止
    if (game.timers?.length > 0) {
        game.timers.forEach(t => clearTimeout(t));
    }
    game.timers = [];

    // メッセージ/ボタン Collector を全停止
    if (game.collectors?.length > 0) {
        game.collectors.forEach(c => {
            try { c.stop(); } catch (_) { /* 既に終了済みでも無視 */ }
        });
    }
    game.collectors = [];

    // ガヤインターバルを停止
    if (game.gayaInterval) {
        clearInterval(game.gayaInterval);
        game.gayaInterval = null;
    }
}

export function resetGame(channelId: string, force = false): void {
    const game = games.get(channelId);
    if (!game) return;

    game.state = 'idle';
    stopAllGameTimers(game);

    if (force) {
        games.delete(channelId);
    } else {
        const availablePlayers = game.players.filter(p => !p.isNpc && !findGameByUserId(p.id));
        game.state = 'recruiting';
        game.dayCount = 0;
        game.history = [];
        game.chatLog = [];
        game.timeline = [];
        game.voteLog = [];
        game.actions = [];
        game.evidence = [];
        game.cursedTarget = null;
        game.lovers = [];
        game.lastExecutionResult = null;
        game.winnerTeam = null;
        game.isRevote = false;
        game.revoteCandidates = [];
        game.timelineFinalized = false;
        
        // 以下のリセット処理を追加！
        game.hasGodUsedPower = false;
        game.hasDictatorUsedPower = false;
        game.devoteeTarget = undefined;
        game.dictatorTarget = undefined;
        game.coronerReport = undefined;
        game.hasDividerUsedPower = false;
        game.dividedGroups = null;
        game.sectorAChannel = undefined;
        game.sectorBChannel = undefined;
        game.hasNecromancerUsedPower = false;
        game.necromancerTarget = undefined;
        game.godCoWin = false;

        game.players = availablePlayers.map(p => ({
            id: p.id, user: p.user, name: p.name, isNpc: false, ghostBet: null,
            lastGuarded: null, settings: undefined
        }));
        if (!game.players.some(p => p.id === game.hostId)) game.hostId = game.players[0]?.id ?? '';
    }
}
