import type { Message, TextChannel, User } from "discord.js";

export type RoleName =
  | "村人"
  | "人狼"
  | "狂人"
  | "占い師"
  | "騎士"
  | "霊能者"
  | "共有者"
  | "検死官"
  | "タフガイ"
  | "逃亡者"
  | "暗殺者"
  | "猫又"
  | "狂信者"
  | "妖術師"
  | "分断者"
  | "妖狐"
  | "キューピッド"
  | "純愛者"
  | "方位磁針"
  | "狼憑き"
  | "呪われた村人"
  | "パン屋"
  | "市長"
  | "怪盗"
  | "てるてる"
  | "饒舌な人狼";
export type RoleConfig = Record<RoleName, number>;
export type GamePhase = "lobby" | "day" | "voting" | "night" | "ended";
export type Winner = "villager" | "wolf" | "fox" | "lovers" | "teruteru";
export type RoleTeam = "villager" | "wolf" | "third";
export type NpcPersonality = "慎重" | "直感" | "追及" | "同調";
export type NpcSeerClaimPlan = "day1" | "day2" | "never";
export type PublicResult = "人狼" | "人間";
export type ClaimedRole = "占い師" | "霊能者" | "騎士";
export type HumanArgumentReason =
  | "black-result"
  | "vote-contradiction"
  | "broken-claim"
  | "counter-claim"
  | "previous-votes"
  | "intuition";

export interface HumanArgument {
  targetId: string;
  reason: HumanArgumentReason;
}

export interface VoteRecord {
  day: number;
  round: number;
  ballots: Array<{ voterId: string; targetId: string }>;
}

export interface RoleClaim {
  day: number;
  /** 何日目の判定として公開したか。day は実際に公開した日。 */
  resultDay?: number;
  speakerId: string;
  claimedRole: "占い師" | "霊能者";
  targetId: string;
  result: PublicResult;
}

export interface ClaimHistoryEntry {
  action: "claim" | "retract";
  day: number;
  speakerId: string;
  claimedRole: ClaimedRole;
  targetId?: string;
  result?: PublicResult;
  resultDay?: number;
}

export interface NightActionChoice {
  actorId: string;
  targetId: string;
}

export interface NightHistoryEntry {
  day: number;
  wolfChoices: NightActionChoice[];
  guardChoices: NightActionChoice[];
  seerChoices: NightActionChoice[];
  specialChoices?: Array<{
    action: string;
    actorId: string;
    targetIds: string[];
  }>;
  attackTargetId?: string;
  victimId?: string;
  deathIds?: string[];
  guarded: boolean;
}

export interface Player {
  id: string;
  name: string;
  user: User | null;
  isNpc: boolean;
  npcPersonality?: NpcPersonality;
  role?: RoleName;
  alive: boolean;
}

export interface GameState {
  channelId: string;
  channel: TextChannel;
  hostId: string;
  phase: GamePhase;
  players: Player[];
  targetPlayerCount: number;
  roleConfig: RoleConfig;
  roleDmSent: Set<string>;
  roleDmFailures: Set<string>;
  pendingDmMessages: Map<string, string[]>;
  day: number;
  voteRound: number;
  voteCandidateIds: string[];
  lobbyMessage?: Message;
  phaseMessage?: Message;
  phaseStartedAt?: number;
  phaseEndsAt?: number;
  votes: Map<string, string>;
  voteHistory: VoteRecord[];
  nightChoices: Map<string, string>;
  npcSuspicion: Map<string, number>;
  npcMemory: Map<string, Map<string, number>>;
  npcClaims: RoleClaim[];
  claimHistory: ClaimHistoryEntry[];
  npcSeerClaimPlans: Map<string, NpcSeerClaimPlan>;
  roleDeclarations: Set<string>;
  humanSuspicions: Map<string, HumanArgument>;
  npcQuestionCounts: Map<string, number>;
  seerResults: Map<string, Array<{ targetId: string; isWolf: boolean }>>;
  openingDeathIds?: string[];
  lastExecuted?: Player;
  executionHistory: Player[];
  nightHistory: NightHistoryEntry[];
  postgameRecapState: "idle" | "showing" | "shown";
  wolfChatCounts: Map<string, number>;
  loverPairs?: Array<[string, string]>;
  devoteeTargets?: Map<string, string>;
  usedRolePowers?: Set<string>;
  fatalWoundIds?: Set<string>;
  pendingDivision?: { targetId: string; day: number };
  divisionGroups?: Map<string, "A" | "B">;
  loquaciousMissions?: Map<string, string>;
  loquaciousCompleted?: Set<string>;
  timers: NodeJS.Timeout[];
  resolving: boolean;
  resolutionQueued: boolean;
  statsMatchId?: string;
  statsRecorded?: boolean;
  analyticsSessionId?: string;
  analyticsSourceSessionId?: string;
  analyticsChainId?: string;
  analyticsStartedAt?: number;
  analyticsCompleted?: boolean;
  analyticsPending?: Promise<void>;
  analyticsFeedbackPromptShown?: boolean;
  analyticsFeedbackMessageId?: string;
  analyticsFeedbackSessionId?: string;
  analyticsFeedbackEligibleUserIds?: Set<string>;
  analyticsFeedbackSubmittedUserIds?: Set<string>;
  analyticsFeedbackSubmittingUserIds?: Set<string>;
  starting?: boolean;
}
