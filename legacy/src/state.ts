// src/state.ts
import { GameState } from './types';
import { User, TextChannel } from 'discord.js';

export const games = new Map<string, GameState>();

/** * 状態の初期化はこの関数に完全集約する。
 * 変数を足す時は必ずここだけに追加すること。
 */
export function createEmptyState(): GameState {
    return {
        state: 'idle',
        channel: null,
        hostId: '',
        lobbyMessage: null,
        players: [],
        npcCount: 0,
        settings: {
            wolfMode: 'auto',
            roles: ['seer'],
            discussionTime: 30,
            autoFinishVoting: true,
            gayaMode: false,
            willMode: false,
            firstNightPeace: true,
            voteTransparency: 'anonymous',
            tieVoteHandling: 'random',
            continuousGuard: true,
            matchType: 'casual',
            mediumInfo: 'team',
            loquaciousMode: false,
        },
        settingsTab: 'basic',
        dayCount: 0,
        history: [],
        chatLog: [],
        voteLog: [],
        timeline: [],
        timelineFinalized: false,
        actions: [],
        evidence: [],
        lastExecutionResult: null,
        winnerTeam: null,
        isRevote: false,
        revoteCandidates: [],
        lovers: [],
        cursedTarget: null,
        coronerReport: undefined,
        devoteeTarget: undefined,
        hasGodUsedPower: false,
        hasAssassinUsedPower: false,
        hasDictatorUsedPower: false,
        dictatorTarget: undefined,
        hasDividerUsedPower: false,
        dividedGroups: null,
        hasNecromancerUsedPower: false,
        necromancerTarget: undefined,
        hasCompassUsedPower: false,
        godCoWin: false,
        timers: [],
        gayaInterval: null,
        collectors: [],
        sectorAChannel: undefined,
        sectorBChannel: undefined,
        wolfChannel: undefined,
    };
}

export function hasGame(channelId: string): boolean {
    return games.has(channelId);
}

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
        if (g.state === 'playing' && g.players?.some(p => p.id === userId)) return g;
    }
    for (const [, g] of games.entries()) {
        if (g.players?.some(p => p.id === userId)) return g;
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
        id: author.id, user: author, name: author.username, isNpc: false, settings: undefined
    }];
    return game;
}

function stopAllGameTimers(game: GameState): void {
    if (game.timers?.length > 0) game.timers.forEach(t => clearTimeout(t));
    game.timers = [];

    if (game.collectors?.length > 0) {
        game.collectors.forEach(c => {
            try { c.stop(); } catch (_) {}
        });
    }
    game.collectors = [];

    if (game.gayaInterval) {
        clearInterval(game.gayaInterval);
        game.gayaInterval = null;
    }
}

/**
 * ゲーム状態のリセット処理。
 * Object.assignを使うことで、初期化漏れバグを完全に防ぐ構造に改修。
 */
export function resetGame(channelId: string, force = false): void {
    const game = games.get(channelId);
    if (!game) return;

    stopAllGameTimers(game);

    if (force) {
        games.delete(channelId);
    } else {
        // 1. 維持したいデータ（プレイヤー情報、設定など）を退避
        const preservedPlayers = game.players.filter(p => !p.isNpc).map(p => ({
            id: p.id, user: p.user, name: p.name, isNpc: false, ghostBet: null,
            lastGuarded: null, settings: undefined
        }));
        const preservedChannel = game.channel;
        const preservedHost = game.hostId;
        const preservedSettings = game.settings;
        const preservedNpcCount = game.npcCount; // ★ これを追加！

        // 2. まっさらな初期状態で全体を上書きリセット
        Object.assign(game, createEmptyState());

        // 3. 退避したデータを復元して募集状態へ
        game.channel = preservedChannel;
        game.hostId = preservedHost;
        game.players = preservedPlayers;
        game.settings = preservedSettings;
        game.npcCount = preservedNpcCount; // ★ これも追加！
        game.state = 'recruiting';
    }
}

export function getAllGames() { return games; }
export function getPlayingGameCount(): number { return Array.from(games.values()).filter(g => g.state === 'playing').length; }
export function getRecruitingGameCount(): number { return Array.from(games.values()).filter(g => g.state === 'recruiting').length; }
export function getActiveGameCount(): number { return Array.from(games.values()).filter(g => g.state === 'playing' || g.state === 'recruiting').length; }
