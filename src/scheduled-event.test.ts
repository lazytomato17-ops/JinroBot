import { describe, expect, it } from "vitest";
import {
  isRecruitButton,
  parseRecruitButtonCustomId,
  recruitButtonCustomId,
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
