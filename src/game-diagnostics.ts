import { createHash, randomUUID } from "node:crypto";
import { MessageFlags } from "discord.js";
import {
  analyticsAppVersion,
  recordDiagnosticEvents,
  type AnalyticsResult,
  type DiagnosticRow,
} from "./analytics";
import type { GameState } from "./types";

const BOOT_ID = randomUUID();
export const POSTGAME_LOG_MS = 3 * 60_000;
const MAX_MESSAGES = 2000;
type Metadata = DiagnosticRow["metadata"];

/** Bounded, non-blocking transport; retries use the same event IDs. No disk spool. */
export class DiagnosticBuffer {
  private pending: DiagnosticRow[] = [];
  private flushing = false;
  private timer?: ReturnType<typeof setTimeout>;
  private dropped = 0;

  constructor(
    private readonly writer = recordDiagnosticEvents,
    private readonly limit = 1000,
  ) {}

  push(row: DiagnosticRow): void {
    if (this.pending.length >= this.limit) {
      this.dropped++;
      return;
    }
    if (this.dropped) {
      row.metadata.dropped_before = this.dropped;
      this.dropped = 0;
    }
    this.pending.push(row);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.flushing || !this.pending.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 2000);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.pending.length) return;
    this.flushing = true;
    const rows = this.pending.splice(0, 50);
    let result: AnalyticsResult = { status: "failed" };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await this.writer(rows);
        } catch {
          result = { status: "failed" };
        }
        if (result.status !== "failed") break;
      }
      if (result.status === "failed") {
        this.dropped += rows.length;
        console.warn(
          "Game diagnostic batch lost after 3 attempts (no message contents logged).",
        );
      }
    } finally {
      this.flushing = false;
      this.schedule();
    }
  }
}

const buffer = new DiagnosticBuffer();

export function redactDiagnosticText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{6}\.[\w-]{20,}|(?:sb_secret_|sk-)[\w-]{12,})/g,
      "[REDACTED]",
    )
    .replace(
      /\b(?:password|token|api[_-]?key|secret)\s*[:=]\s*\S+/gi,
      "[REDACTED]",
    )
    .replace(/<@!?\d+>/g, "[mention]")
    .slice(0, 4000);
}

/** Only codes/classes, never error.message, stack, interaction values or role DMs. */
export function diagnosticErrorCode(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return typeof code === "number" ||
    (typeof code === "string" && /^[A-Z_0-9-]{1,40}$/.test(code))
    ? String(code)
    : "unknown";
}

interface Recording {
  game: GameState;
  sessionId: string;
  sequence: number;
  messages: number;
  seen: Map<string, string>;
  lastPhase: string;
  endedAt?: number;
  endedDay?: number;
  participantAliases: Map<string, string>;
  timer: ReturnType<typeof setInterval>;
}
const recordings = new Map<string, Recording>();
const lastSequences = new WeakMap<
  GameState,
  { sessionId: string; sequence: number }
>();

function emit(
  recording: Recording,
  kind: string,
  metadata: Metadata = {},
  actor: string | null = null,
  content: string | null = null,
): void {
  lastSequences.set(recording.game, {
    sessionId: recording.sessionId,
    sequence: recording.sequence + 1,
  });
  buffer.push({
    event_id: randomUUID(),
    session_id: recording.sessionId,
    boot_id: BOOT_ID,
    sequence: ++recording.sequence,
    occurred_at: new Date().toISOString(),
    app_version: analyticsAppVersion(),
    kind,
    day: recording.endedDay ?? recording.game.day,
    phase: recording.endedAt === undefined ? recording.game.phase : "ended",
    actor,
    content,
    metadata,
  });
}

export function recordGameDiagnostic(
  game: GameState,
  kind: string,
  metadata: Metadata = {},
): void {
  const recording = recordings.get(game.channelId);
  if (
    recording?.game !== game ||
    recording.sessionId !== game.analyticsSessionId
  )
    return;
  if (
    recording.endedAt !== undefined &&
    Date.now() >= recording.endedAt + POSTGAME_LOG_MS
  ) {
    close(recording, "postgame_timeout");
    return;
  }
  emit(recording, kind, metadata);
}

function snapshot(recording: Recording): void {
  const { game } = recording;
  const phase = `${game.day}:${game.phase}`;
  emit(recording, phase === recording.lastPhase ? "heartbeat" : "phase", {
    alive: game.players.filter((player) => player.alive).length,
    votes_received: game.votes.size,
    pending_role_dms: game.roleDmFailures.size,
    phase_ends_at: game.phaseEndsAt ?? null,
    resolving: game.resolving,
  });
  recording.lastPhase = phase;
}

/** Rematches mutate GameState in place; session ID, not object identity, is the boundary. */
export function startGameDiagnostics(game: GameState): void {
  if (!game.analyticsSessionId) return;
  const previous = recordings.get(game.channelId);
  if (previous?.game === game && previous.sessionId === game.analyticsSessionId)
    return;
  if (previous) close(previous, "next_game");
  const previousSequence = lastSequences.get(game);
  const recording: Recording = {
    game,
    sessionId: game.analyticsSessionId,
    sequence:
      previousSequence?.sessionId === game.analyticsSessionId
        ? previousSequence.sequence
        : 0,
    messages: 0,
    seen: new Map(),
    lastPhase: "",
    participantAliases: new Map(
      game.players.flatMap((player, index) =>
        player.isNpc ? [] : [[player.id, `P${index + 1}`] as const],
      ),
    ),
    timer: setInterval(() => {
      if (recording.endedAt !== undefined) {
        if (Date.now() >= recording.endedAt + POSTGAME_LOG_MS)
          close(recording, "postgame_timeout");
      } else snapshot(recording);
    }, 30_000),
  };
  recording.timer.unref();
  recordings.set(game.channelId, recording);
  emit(recording, "start", {
    humans: game.players.filter((player) => !player.isNpc).length,
    npcs: game.players.filter((player) => player.isNpc).length,
  });
  snapshot(recording);
}

function close(recording: Recording, reason: string): void {
  emit(recording, "recording_closed", { reason });
  clearInterval(recording.timer);
  if (recordings.get(recording.game.channelId) === recording)
    recordings.delete(recording.game.channelId);
}

export function finishGameDiagnostics(
  game: GameState,
  reason: "completed" | "reset" | "panel_failure",
): void {
  const recording = recordings.get(game.channelId);
  if (
    recording?.game !== game ||
    recording.sessionId !== game.analyticsSessionId
  )
    return;
  if (recording.endedAt !== undefined) {
    if (reason !== "completed") close(recording, reason);
    return;
  }
  emit(recording, "finish", { reason });
  if (reason !== "completed") close(recording, reason);
  else {
    recording.endedAt = Date.now();
    recording.endedDay = game.day;
  }
}

export interface DiagnosticMessage {
  id: string;
  guildId: string | null;
  channelId: string;
  author: { id: string; bot: boolean } | null;
  content: string | null;
  embeds: readonly {
    title?: string | null;
    description?: string | null;
    fields?: readonly { name: string; value: string }[];
  }[];
  editedTimestamp?: number | null;
  flags?: { has(flag: number): boolean };
  client: { user: { id: string } | null };
}

/** No history fetch. No DMs, spectators, other bots, files or other channels. */
export function recordGameMessage(
  message: DiagnosticMessage,
  operation: "create" | "edit" | "delete" = "create",
): void {
  if (
    !message.guildId ||
    !message.author ||
    message.flags?.has(MessageFlags.Ephemeral)
  )
    return;
  for (const recording of recordings.values()) {
    const { game } = recording;
    if (game.channel.guildId !== message.guildId) continue;
    const room =
      game.channelId === message.channelId
        ? "main"
        : [...(game.divisionChannels ?? [])].find(
            ([, channel]) => channel.id === message.channelId,
          )?.[0];
    if (!room) continue;
    // Do not import edits/deletions of messages posted before recording began.
    if (operation !== "create" && !recording.seen.has(message.id)) return;
    if (
      recording.endedAt !== undefined &&
      Date.now() >= recording.endedAt + POSTGAME_LOG_MS
    ) {
      close(recording, "postgame_timeout");
      return;
    }
    const ownBot =
      message.author.bot && message.author.id === message.client.user?.id;
    // After a match, collect participant feedback only, not a new lobby's bot UI.
    if (ownBot && recording.endedAt !== undefined) return;
    const actorAlias = recording.participantAliases.get(message.author.id);
    if (!ownBot && (message.author.bot || !actorAlias)) return;
    const raw = ownBot
      ? [
          message.content ?? "",
          ...message.embeds.flatMap((embed) => [
            embed.title ?? "",
            embed.description ?? "",
            ...(embed.fields ?? []).map(
              (field) => `${field.name}\n${field.value}`,
            ),
          ]),
        ].join("\n")
      : (message.content ?? "");
    const content = operation === "delete" ? null : redactDiagnosticText(raw);
    const fingerprint = createHash("sha256")
      .update(`${operation}:${content}`)
      .digest("hex");
    if (recording.seen.get(message.id) === fingerprint) return;
    if (recording.messages >= MAX_MESSAGES) return;
    recording.seen.set(message.id, fingerprint);
    recording.messages++;
    emit(
      recording,
      recording.endedAt === undefined ? "message" : "postgame_message",
      {
        operation,
        room,
        message_id: message.id,
        truncated: raw.length > 4000,
        content_unavailable: operation !== "delete" && raw.length === 0,
      },
      ownBot ? "BOT" : actorAlias!,
      content,
    );
    if (recording.messages === MAX_MESSAGES)
      emit(recording, "message_limit", { limit: MAX_MESSAGES });
    return;
  }
}

export function recordGameInteractionError(
  channelId: string,
  userId: string,
  error: unknown,
): void {
  for (const recording of recordings.values()) {
    if (
      recording.game.channelId !== channelId &&
      ![...(recording.game.divisionChannels?.values() ?? [])].some(
        (channel) => channel.id === channelId,
      )
    )
      continue;
    if (!recording.participantAliases.has(userId)) return;
    recordGameDiagnostic(recording.game, "error", {
      source: "interaction",
      code: diagnosticErrorCode(error),
    });
    return;
  }
}
