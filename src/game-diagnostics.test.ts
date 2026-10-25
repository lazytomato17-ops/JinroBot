import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticRow, AnalyticsResult } from "./analytics";
import type { GameState } from "./types";

const mocks = vi.hoisted(() => ({ rows: [] as DiagnosticRow[] }));
vi.mock("./analytics", () => ({
  analyticsAppVersion: () => "test-version",
  recordDiagnosticEvents: vi.fn(async (rows: DiagnosticRow[]) => {
    mocks.rows.push(...rows);
    return { status: "saved" };
  }),
}));

function game(session = "session-1"): GameState {
  return {
    analyticsSessionId: session,
    channelId: "main",
    channel: { guildId: "guild" },
    day: 1,
    phase: "day",
    phaseEndsAt: 100000,
    resolving: false,
    players: [
      { id: "human", isNpc: false, alive: true },
      { id: "npc", isNpc: true, alive: true },
    ],
    votes: new Map(),
    roleDmFailures: new Set(),
    divisionChannels: new Map([["A", { id: "split" }]]),
  } as unknown as GameState;
}

function message(content = "占い結果が怪しい", id = "message-1") {
  return {
    id,
    guildId: "guild",
    channelId: "main",
    author: { id: "human", bot: false },
    content,
    embeds: [],
    client: { user: { id: "bot" } },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
  vi.resetModules();
  mocks.rows.length = 0;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("private match diagnostics", () => {
  it("the actual Discord message handler forwards public game messages", async () => {
    const d = await import("./game-diagnostics");
    const { handleGuildMessage } = await import("./game");
    d.startGameDiagnostics(game());
    const m = { ...message("実際のハンドラー"), inGuild: () => true };
    await handleGuildMessage(
      m as unknown as Parameters<typeof handleGuildMessage>[0],
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.rows.some((row) => row.content === "実際のハンドラー")).toBe(
      true,
    );
  });

  it("records participant messages and only this bot's public text, with aliases", async () => {
    const d = await import("./game-diagnostics");
    const g = game();
    d.startGameDiagnostics(g);
    d.recordGameMessage(message());
    d.recordGameMessage({
      ...message("NPC発言", "bot-message"),
      author: { id: "bot", bot: true },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      mocks.rows
        .filter((row) => row.kind === "message")
        .map((row) => [row.actor, row.content]),
    ).toEqual([
      ["P1", "占い結果が怪しい"],
      ["BOT", "NPC発言"],
    ]);
    expect(JSON.stringify(mocks.rows)).not.toContain('"human"');
  });

  it("excludes DMs, spectators, NPC-shaped IDs, other bots, guilds and channels", async () => {
    const d = await import("./game-diagnostics");
    d.startGameDiagnostics(game());
    d.recordGameMessage({ ...message(), guildId: null });
    d.recordGameMessage({ ...message(), guildId: "other" });
    d.recordGameMessage({ ...message(), channelId: "other" });
    d.recordGameMessage({
      ...message(),
      author: { id: "spectator", bot: false },
    });
    d.recordGameMessage({ ...message(), author: { id: "npc", bot: false } });
    d.recordGameMessage({
      ...message(),
      author: { id: "other-bot", bot: true },
    });
    d.recordGameMessage(message("過去の会話", "old"), "edit");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.rows.some((row) => row.kind === "message")).toBe(false);
  });

  it("records managed division channels, edits and deletes without fetching history", async () => {
    const d = await import("./game-diagnostics");
    d.startGameDiagnostics(game());
    const m = { ...message(), channelId: "split" };
    d.recordGameMessage(m);
    d.recordGameMessage(m);
    d.recordGameMessage({ ...m, content: "訂正" }, "edit");
    d.recordGameMessage(m, "delete");
    await vi.advanceTimersByTimeAsync(2000);
    const rows = mocks.rows.filter((row) => row.kind === "message");
    expect(rows.map((row) => row.metadata.operation)).toEqual([
      "create",
      "edit",
      "delete",
    ]);
    expect(rows.every((row) => row.metadata.room === "A")).toBe(true);
    expect(rows[2].content).toBeNull();
  });

  it("keeps feedback for precisely 3 minutes, not forever", async () => {
    const d = await import("./game-diagnostics");
    const g = game();
    d.startGameDiagnostics(g);
    d.finishGameDiagnostics(g, "completed");
    g.phase = "ended";
    d.recordGameMessage(message("感想"));
    await vi.advanceTimersByTimeAsync(d.POSTGAME_LOG_MS - 1);
    d.recordGameMessage(message("直前", "last"));
    await vi.advanceTimersByTimeAsync(1);
    d.recordGameMessage(message("時間外", "outside"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      mocks.rows
        .filter((row) => row.kind === "postgame_message")
        .map((row) => row.content),
    ).toEqual(["感想", "直前"]);
  });

  it("stops the previous postgame window on rematch; no mixed sessions", async () => {
    const d = await import("./game-diagnostics");
    const old = game();
    d.startGameDiagnostics(old);
    d.finishGameDiagnostics(old, "completed");
    d.recordGameMessage(message("前の感想"));
    d.startGameDiagnostics(game("session-2"));
    d.recordGameMessage(message("次の発言", "next"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      mocks.rows.find((row) => row.content === "前の感想")?.session_id,
    ).toBe("session-1");
    expect(
      mocks.rows.find((row) => row.content === "次の発言")?.session_id,
    ).toBe("session-2");
  });

  it("does not collect a fresh lobby's bot messages as feedback", async () => {
    const d = await import("./game-diagnostics");
    const g = game();
    d.startGameDiagnostics(g);
    d.finishGameDiagnostics(g, "completed");
    d.recordGameMessage({
      ...message("新ロビー"),
      author: { id: "bot", bot: true },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.rows.some((row) => row.content === "新ロビー")).toBe(false);
  });

  it("stops on reset/failure; retry sequence numbers cannot conflict", async () => {
    const d = await import("./game-diagnostics");
    const g = game();
    d.startGameDiagnostics(g);
    d.finishGameDiagnostics(g, "panel_failure");
    d.recordGameMessage(message("記録外"));
    d.startGameDiagnostics(g);
    d.recordGameMessage(message("再試行", "retry"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.rows.some((row) => row.content === "記録外")).toBe(false);
    const seq = mocks.rows.map((row) => row.sequence);
    expect(new Set(seq).size).toBe(seq.length);
    d.finishGameDiagnostics(g, "reset");
  });

  it("records heartbeat deadlines and codes without leaking errors or roles", async () => {
    const d = await import("./game-diagnostics");
    const g = game();
    d.startGameDiagnostics(g);
    d.recordGameInteractionError("main", "human", {
      code: 50013,
      message: "secret conversation",
    });
    await vi.advanceTimersByTimeAsync(32000);
    expect(
      mocks.rows.find((row) => row.kind === "heartbeat")?.metadata
        .phase_ends_at,
    ).toBe(100000);
    expect(mocks.rows.find((row) => row.kind === "error")?.metadata.code).toBe(
      "50013",
    );
    expect(JSON.stringify(mocks.rows)).not.toContain("secret conversation");
    expect(d.diagnosticErrorCode({ code: "private text" })).toBe("unknown");
  });

  it("caps message volume but keeps progress/error events", async () => {
    const d = await import("./game-diagnostics");
    const g = game();
    d.startGameDiagnostics(g);
    // Flush each small group to exercise the session cap, not the transport cap.
    for (let chunk = 0; chunk < 41; chunk++) {
      for (let i = 0; i < 50; i++)
        d.recordGameMessage(message("x", String(chunk * 50 + i)));
      await vi.advanceTimersByTimeAsync(4000);
    }
    d.recordGameDiagnostic(g, "error", { source: "test" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.rows.filter((row) => row.kind === "message")).toHaveLength(
      2000,
    );
    expect(
      mocks.rows.filter((row) => row.kind === "message_limit"),
    ).toHaveLength(1);
    expect(mocks.rows.some((row) => row.kind === "error")).toBe(true);
  });

  it("redacts common credentials and URLs, truncates text, but does not promise anonymity", async () => {
    const { redactDiagnosticText } = await import("./game-diagnostics");
    const result = redactDiagnosticText(
      "名前 token=abc Bearer hidden https://example.com/?secret=123 <@1010400040797360218> " +
        "x".repeat(5000),
    );
    expect(result).toHaveLength(4000);
    expect(result).toContain("名前");
    for (const secret of [
      "abc",
      "hidden",
      "example.com",
      "1010400040797360218",
    ])
      expect(result).not.toContain(secret);
  });
});

describe("bounded transport", () => {
  function row(id: string): DiagnosticRow {
    return {
      event_id: id,
      session_id: "s",
      boot_id: "b",
      sequence: 1,
      occurred_at: "now",
      app_version: "v",
      kind: "test",
      day: 1,
      phase: "day",
      actor: null,
      content: null,
      metadata: {},
    };
  }
  it("retries the same IDs without blocking push, then marks a lost batch", async () => {
    const { DiagnosticBuffer } = await import("./game-diagnostics");
    const writer = vi.fn(
      async (): Promise<AnalyticsResult> => ({ status: "failed" }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const buffer = new DiagnosticBuffer(writer);
    buffer.push(row("one"));
    await buffer.flush();
    expect(writer).toHaveBeenCalledTimes(3);
    expect(writer.mock.calls[0]).toEqual(writer.mock.calls[2]);
    writer.mockResolvedValue({ status: "saved" });
    const next = row("two");
    buffer.push(next);
    await buffer.flush();
    expect(next.metadata.dropped_before).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
  });
  it("bounds pending memory and reports overflow on the next accepted event", async () => {
    const { DiagnosticBuffer } = await import("./game-diagnostics");
    const writer = vi.fn(
      async (): Promise<AnalyticsResult> => ({ status: "saved" }),
    );
    const buffer = new DiagnosticBuffer(writer, 2);
    buffer.push(row("1"));
    buffer.push(row("2"));
    buffer.push(row("3"));
    await buffer.flush();
    const next = row("4");
    buffer.push(next);
    await buffer.flush();
    expect(next.metadata.dropped_before).toBe(1);
  });
});
