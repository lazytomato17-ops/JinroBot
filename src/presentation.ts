// Not a Discord user ID. Keep an explicit ballot distinct from missing votes.
export const NO_EXECUTION_VOTE = "__no_execution__";

export type VoteOutcome =
  | { kind: "execute"; targetId: string }
  | { kind: "revote"; candidateIds: string[] }
  | { kind: "no-execution"; candidateIds: string[] };

export function relativeTime(endsAt?: number): string {
  if (!endsAt) return "まもなく";
  return `<t:${Math.floor(endsAt / 1000)}:R>`;
}

export function discussionDuration(
  alivePlayerCount: number,
  aliveHumanCount: number,
): number {
  if (aliveHumanCount === 0) return 12;
  if (alivePlayerCount <= 5) return 45;
  if (alivePlayerCount <= 8) return 60;
  if (alivePlayerCount <= 11) return 75;
  return 90;
}

export function topVotedIds(votes: string[]): string[] {
  const counts = countVotes(votes);
  if (counts.length === 0) return [];
  const top = counts[0].count;
  return counts.filter((entry) => entry.count === top).map((entry) => entry.id);
}

export function countVotes(
  votes: string[],
): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const targetId of votes) {
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => right.count - left.count);
}

export function resolveVoteOutcome(
  votes: string[],
  round: number,
): VoteOutcome {
  const candidateIds = topVotedIds(votes);
  if (candidateIds.length === 0) {
    return { kind: "no-execution", candidateIds: [] };
  }
  if (candidateIds.length === 1) {
    if (candidateIds[0] === NO_EXECUTION_VOTE)
      return { kind: "no-execution", candidateIds };
    return { kind: "execute", targetId: candidateIds[0] };
  }
  if (round >= 2) return { kind: "no-execution", candidateIds };
  return { kind: "revote", candidateIds };
}
