// src/types.ts
import { User, TextChannel } from 'discord.js';

export interface ResultSummary {
    total_days: number;
    winner_team: string;
    players: Record<string, {
        name: string;
        role: string;
        team: string;
        is_alive: boolean;
        death_day: number | null;
        death_reason: 'execution' | 'kill' | 'sudden_death' | null;
    }>;
}

export interface Player {
    settings: any;
    id: string;
    user: User | null;
    name: string;
    isNpc: boolean;
    role?: string;
    alive?: boolean;
    deathDay?: number | null;
    deathReason?: 'execution' | 'kill' | 'sudden_death' | null;
    isFakeSeer?: boolean;
    isFakeMedium?: boolean;
    knownWolf?: string | null;
    isHiding?: boolean;
    hideStrategy?: boolean;
    personality?: string;
    ghostBet?: 'villager' | 'wolf' | 'other' | null;
    betDeadline?: number;
    lastGuarded?: string | null;
    fatalWound?: boolean;
    wordToSay?: string;
    hasSaidWord?: boolean;
}

export interface Settings {
    wolfMode: 'auto' | number;
    roles: string[];
    discussionTime: number;
    autoFinishVoting: boolean;
    gayaMode: boolean;
    willMode: boolean;
    firstNightPeace: boolean;
    voteTransparency: 'public' | 'anonymous';
    tieVoteHandling: 'peace' | 'random' | 'revote';
    continuousGuard: boolean;
    loquaciousMode: boolean;
    matchType: 'casual' | 'ranked';
    mediumInfo: 'team' | 'full';
    playerCount?: number;
}

export interface GameAction {
    type: string;
    from: string;
    target: string;
    result?: boolean | string;
}

export interface Evidence {
    type: string;
    day: number;
    from: string;
    target: string;
    result: boolean;
    visible: boolean;
}

export interface TimelineEvent {
    type: 'system' | 'phase' | 'chat' | 'vote' | 'execution' | 'death' | 'action' | 'winner';
    day?: number;
    content?: string;
    detail?: string;
    id?: string;
    name?: string;
    isWill?: boolean;
    data?: Record<string, string>;
    from?: string;
    target?: string;
    result?: boolean | string;
}

export interface GameState {
    state: 'idle' | 'recruiting' | 'playing';
    channel: TextChannel | any | null;
    hostId: string;
    lobbyMessage: any;
    players: Player[];
    npcCount: number;
    dayCount: number;
    history: string[];
    chatLog: { id: string; name: string; content: string; day: number }[];
    voteLog: { day: number; votes: Record<string, string> }[];
    timeline: TimelineEvent[];
    gayaInterval: NodeJS.Timeout | null;
    lovers: string[];
    settings: Settings;
    settingsTab?: 'basic' | 'rule' | 'advanced';
    actions: GameAction[];
    evidence: Evidence[];
    cursedTarget: string | null;
    coronerReport?: string;
    lastExecutionResult: { id: string; isWolf: boolean } | null;
    winnerTeam: string | null;
    timers: NodeJS.Timeout[];
    /** メッセージ/ボタンCollectorを追跡してリセット時に停止できるようにする */
    collectors: { stop: () => void }[];
    isRevote?: boolean;
    revoteCandidates?: string[];
    resultSummary?: ResultSummary;
    devoteeTarget?: string;
    hasGodUsedPower?: boolean;
    hasDictatorUsedPower?: boolean;
    dictatorTarget?: string;
    timelineFinalized?: boolean;
    hasDividerUsedPower?: boolean;
    dividedGroups?: { roomA: string[]; roomB: string[] } | null;
    hasNecromancerUsedPower?: boolean;
    necromancerTarget?: string;
    godCoWin?: boolean;
    sectorAChannel?: any; // 一時チャンネルAのオブジェクト
    sectorBChannel?: any; // 一時チャンネルBのオブジェクト
    wolfChannel?: any;
}