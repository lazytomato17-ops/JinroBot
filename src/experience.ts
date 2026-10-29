import { ROLE_INFO, ROLE_NAMES } from "./roles";
import type { GameState, RoleName } from "./types";

export const NPC_FEEDBACK_DETAILS = {
  unfair: "不公平に感じた",
  inconsistent: "発言と投票が合わない",
  unresponsive: "意見が届かない",
  repetitive: "単調・同じ展開になる",
  unspecified: "詳しくは選ばず送信",
} as const;
export type NpcFeedbackDetail = keyof typeof NPC_FEEDBACK_DETAILS;

export interface ExperienceContext {
  role: RoleName | "unknown";
  humans: number;
  npcs: number;
  profile: "basic" | "special";
}

const BASIC_ROLES = new Set([
  "村人",
  "人狼",
  "占い師",
  "霊能者",
  "騎士",
  "狂人",
]);
export function experienceContext(
  game: Pick<GameState, "players" | "roleConfig">,
  userId: string,
): ExperienceContext {
  const special = Object.entries(game.roleConfig).some(
    ([role, count]) =>
      count > 0 &&
      (!BASIC_ROLES.has(role) ||
        (["占い師", "霊能者", "騎士", "狂人"].includes(role) && count > 1)),
  );
  return {
    role:
      game.players.find((player) => !player.isNpc && player.id === userId)
        ?.role ?? "unknown",
    humans: game.players.filter((player) => !player.isNpc).length,
    npcs: game.players.filter((player) => player.isNpc).length,
    profile: special ? "special" : "basic",
  };
}

export interface ExperienceFeedbackRow {
  rating: string;
  reason?: string | null;
  npc_detail?: string | null;
  experience_context?: Partial<ExperienceContext> | null;
}

export function buildExperienceFeedbackLines(
  rows: ExperienceFeedbackRow[],
): string[] {
  const valid = rows.filter((row) =>
    ["again", "neutral", "issue"].includes(row.rating),
  );
  if (!valid.length) return ["この期間の感想回答はまだありません。"];
  const lines = [`回答 **${valid.length}件**（1人につき1連戦1回答）`];
  for (const [key, label] of Object.entries(NPC_FEEDBACK_DETAILS)) {
    const count = valid.filter(
      (row) => row.reason === "npc" && row.npc_detail === key,
    ).length;
    if (count) lines.push(`NPC：${label} **${count}**`);
  }
  const npcUnknown = valid.filter(
    (row) =>
      row.reason === "npc" &&
      !Object.hasOwn(NPC_FEEDBACK_DETAILS, row.npc_detail ?? ""),
  ).length;
  if (npcUnknown) lines.push(`NPC：詳細未分類 **${npcUnknown}**`);
  const groups: Array<
    [string, (context: Partial<ExperienceContext>) => boolean]
  > = [
    ["ソロ", (c) => c.humans === 1],
    ["複数人", (c) => typeof c.humans === "number" && c.humans >= 2],
    ["基本役のみ・単数能力", (c) => c.profile === "basic"],
    ["追加役・複数能力", (c) => c.profile === "special"],
  ];
  for (const [label, matches] of groups) {
    const group = valid.filter(
      (row) => row.experience_context && matches(row.experience_context),
    );
    if (group.length)
      lines.push(
        `${label}：また遊びたい **${group.filter((r) => r.rating === "again").length}/${group.length}**・気になる **${group.filter((r) => r.rating === "issue").length}/${group.length}**`,
      );
  }
  const roles = ROLE_NAMES.map((role) => ({
    role,
    rows: valid.filter((row) => row.experience_context?.role === role),
  }))
    .filter((entry) => entry.rows.length > 0)
    .sort((a, b) => b.rows.length - a.rows.length)
    .slice(0, 8);
  for (const entry of roles)
    lines.push(
      `${ROLE_INFO[entry.role].icon} ${entry.role}：回答 **${entry.rows.length}**・気になる **${entry.rows.filter((r) => r.rating === "issue").length}**`,
    );
  const missing = valid.filter((row) => !row.experience_context?.role).length;
  if (missing) lines.push(`旧形式・状況未計測 **${missing}件**`);
  lines.push(
    "※ 回答者内の内訳です。未回答者の満足度や新規継続率とは別です。役職・人数は感想募集時点。少数では強弱を断定しません。",
  );
  return lines;
}

export function buildExperienceSessionLines(
  rows: Array<{
    id: string;
    human_count?: number | string | null;
    status?: string | null;
    role_config?: Record<string, number> | null;
  }>,
  participants: Array<{ session_id: string; participant_hash: string }>,
): string[] {
  const groups: Array<[string, (row: (typeof rows)[number]) => boolean]> = [
    ["ソロ", (r) => Number(r.human_count) === 1],
    ["2人", (r) => Number(r.human_count) === 2],
    ["3人以上", (r) => Number(r.human_count) >= 3],
    [
      "追加役あり",
      (r) =>
        Object.entries(r.role_config ?? {}).some(
          ([role, count]) => count > 0 && !BASIC_ROLES.has(role),
        ),
    ],
  ];
  return groups.flatMap(([label, matches]) => {
    const group = rows.filter(matches);
    if (!group.length) return [];
    const ids = new Set(group.map((r) => r.id));
    const users = new Map<string, Set<string>>();
    for (const p of participants) {
      if (!ids.has(p.session_id)) continue;
      const sessions = users.get(p.participant_hash) ?? new Set<string>();
      sessions.add(p.session_id);
      users.set(p.participant_hash, sessions);
    }
    return [
      `${label}：開始 **${group.length}**・完走 **${group.filter((r) => r.status === "completed").length}**・区分内2戦以上 **${[...users.values()].filter((s) => s.size >= 2).length}/${users.size}人**`,
    ];
  });
}
