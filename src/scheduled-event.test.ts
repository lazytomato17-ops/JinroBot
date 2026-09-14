import { describe, expect, it } from "vitest";
import {
  isRecruitButton,
  parseRecruitButtonCustomId,
  parseRecruitStartAt,
  recruitButtonCustomId,
  recruitCommand,
} from "./scheduled-event";

describe("scheduled event recruitment custom ids", () => {
  it("round-trips recruitment button data", () => {
    const data = {
      eventId: "123456789012345678",
      hostId: "234567890123456789",
      targetPlayerCount: 8,
    };
    const customId = recruitButtonCustomId(data);
    expect(parseRecruitButtonCustomId(customId)).toEqual(data);
    expect(isRecruitButton(customId)).toBe(true);
  });

  it("rejects malformed or out-of-range ids", () => {
    expect(parseRecruitButtonCustomId("tb-recruit:start:nope:123:8")).toBeUndefined();
    expect(
      parseRecruitButtonCustomId(
        "tb-recruit:start:123456789012345678:234567890123456789:16",
      ),
    ).toBeUndefined();
    expect(isRecruitButton("tb:join:anything")).toBe(false);
  });
});

describe("recruit setup", () => {
  it("keeps the slash command simple with no required options", () => {
    expect(recruitCommand.toJSON().options ?? []).toHaveLength(0);
  });

  it("parses a JST date and time", () => {
    const result = parseRecruitStartAt(
      "9/20",
      "21:00",
      new Date("2026-09-14T08:00:00.000Z"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    }
  });

  it("accepts full-width input and rolls an omitted past year forward", () => {
    const result = parseRecruitStartAt(
      "１／２",
      "２０：３０",
      new Date("2026-09-14T08:00:00.000Z"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toISOString()).toBe("2027-01-02T11:30:00.000Z");
    }
  });

  it("rejects impossible dates", () => {
    const result = parseRecruitStartAt(
      "2026-02-30",
      "21:00",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(result.ok).toBe(false);
  });
});
