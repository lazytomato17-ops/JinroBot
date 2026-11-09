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
    id: string;
    user: User | null;
    name: string;
    isNpc: boolean;
    settings: any;
    
    // --- ゲーム中のステータス ---
    role?: string;
    alive?: boolean;
    deathDay?: number | null;
    deathReason?: 'execution' | 'kill' | 'sudden_death' | null;
    
    // --- 役職固有・戦術ステータス ---
    isFakeSeer?: boolean;
    isFakeMedium?: boolean;
    knownWolf?: string | null;
    isHiding?: boolean;
    hideStrategy?: boolean;
    lastGuarded?: string | null;
    fatalWound?: boolean;
    
    // --- 特殊モード・NPCステータス ---
    personality?: string;
    wordToSay?: string;
    hasSaidWord?: boolean;
    ghostBet?: 'villager' | 'wolf' | 'other' | null;
    betDeadline?: number;
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
    // --- システム基本情報 ---
    state: 'idle' | 'recruiting' | 'playing';
    channel: TextChannel | any | null;
    hostId: string;
    lobbyMessage: any;
    players: Player[];
    npcCount: number;
    settings: Settings;
    settingsTab?: 'basic' | 'rule' | 'advanced';
    
    // --- ゲーム進行データ ---
    dayCount: number;
    history: string[];
    chatLog: { id: string; name: string; content: string; day: number }[];
    voteLog: { day: number; votes: Record<string, string> }[];
    timeline: TimelineEvent[];
    timelineFinalized?: boolean;
    actions: GameAction[];
    evidence: Evidence[];
    
    // --- 判定・結果データ ---
    lastExecutionResult: { id: string; isWolf: boolean } | null;
    winnerTeam: string | null;
    resultSummary?: ResultSummary;
    isRevote?: boolean;
    revoteCandidates?: string[];
    
    // --- 役職ごとの固有フラグ・ターゲット ---
    lovers: string[];
    cursedTarget: string | null;
    coronerReport?: string;
    devoteeTarget?: string;
    hasGodUsedPower?: boolean;
    hasAssassinUsedPower?: boolean;
    hasDictatorUsedPower?: boolean;
    dictatorTarget?: string;
    hasDividerUsedPower?: boolean;
    dividedGroups?: { roomA: string[]; roomB: string[] } | null;
    hasNecromancerUsedPower?: boolean;
    necromancerTarget?: string;
    hasCompassUsedPower?: boolean;
    godCoWin?: boolean;
    
    // --- 動的制御・タイマー類 ---
    timers: NodeJS.Timeout[];
    gayaInterval: NodeJS.Timeout | null;
    collectors: { stop: () => void }[]; // メッセージ/ボタンCollectorの追跡用
    lastSpeakerTime?: Record<string, number>; // 各NPCの最終発言時刻 (ms)
    pendingReplyQueue?: Player[]; // 名指しされたNPCの返答待ちキュー
    sectorAChannel?: any;
    sectorBChannel?: any;
    wolfChannel?: any;
}