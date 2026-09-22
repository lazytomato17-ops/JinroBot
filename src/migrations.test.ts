import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(
    join(__dirname, "..", "supabase", "migrations", name),
    { encoding: "utf8" },
  ).replace(/\r\n/g, "\n");
}

describe("Supabase移行SQL", () => {
  it("初期ファネルSQLを再実行しても拡張イベントを失わない", () => {
    const base = migration("202608300001_add_guild_activation_funnel.sql");
    const extension = migration(
      "202609010001_extend_guild_activation_funnel.sql",
    );
    const functionMarker =
      "create or replace function public.tomatobot_record_guild_funnel_event";

    expect(base.slice(base.indexOf(functionMarker)).trim()).toBe(
      extension.slice(extension.indexOf(functionMarker)).trim(),
    );
    expect(base).toContain("'quick_start_clicked'");
    expect(base).toContain("'game_completed'");
  });

  it("既存IDの匿名化は1つの生IDを1つの別名へまとめて再流入も拒否する", () => {
    const redaction = migration(
      "202609010002_redact_stored_locations.sql",
    );

    expect(redaction).toContain("select distinct guild_id as raw_id");
    expect(redaction).toContain("select distinct channel_id as raw_id");
    expect(redaction).toContain("tomatobot_play_sessions_no_raw_guild_id");
    expect(redaction).toContain("tomatobot_matches_location_not_collected");
  });

  it("試合分析は個人を保存せず集約JSONだけを受け付ける", () => {
    const gameplay = migration(
      "202609210001_add_gameplay_summary.sql",
    );

    expect(gameplay).toContain("add column if not exists gameplay_summary jsonb");
    expect(gameplay).toContain("gameplay_summary @> '{\"schema\": 1}'::jsonb");
    expect(gameplay).toContain("octet_length(gameplay_summary::text) <= 20000");
    expect(gameplay).not.toContain("user_id");
    expect(gameplay).not.toContain("participant_hash");
    expect(gameplay).not.toContain("target_id");
  });
});
