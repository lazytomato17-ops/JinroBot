import { npcDecisionSuspicion } from "./npc";
import { NO_EXECUTION_VOTE } from "./presentation";
import { chooseNpcRevoteTarget, chooseNpcVoteTarget } from "./solo";
import type { Player } from "./types";

/** Only execution ballots may abstain: never reuse this for attacks/abilities. */
export function chooseNpcExecutionBallot(
  game: Parameters<typeof npcDecisionSuspicion>[0],
  actor: Player,
  candidates: Player[],
  allowNoExecution: boolean,
  random: () => number = Math.random,
  revote?: { previousTargetId?: string; counts: ReadonlyMap<string, number> },
): string | undefined {
  const suspicion = npcDecisionSuspicion(game, actor);
  const target = revote
    ? chooseNpcRevoteTarget(
        actor,
        candidates,
        suspicion,
        revote.previousTargetId,
        revote.counts,
        random,
      )
    : chooseNpcVoteTarget(actor, candidates, suspicion, random);
  if (!allowNoExecution) return target;
  // A shared partner alone, for example, is not a legal execution target.
  if (!target) return NO_EXECUTION_VOTE;
  const living = game.players.filter((player) => player.alive);
  const hasPublicBlack = game.npcClaims.some(
    (claim) =>
      claim.claimedRole === "占い師" &&
      claim.result === "人狼" &&
      living.some((player) => player.id === claim.targetId),
  );
  const strongest = Math.max(
    ...candidates
      .filter((player) => player.id !== actor.id)
      .map((player) => suspicion.get(player.id) ?? 0),
  );
  // Conservative opening choice, not an escape from black evidence or endgames.
  const strongestPublic = Math.max(
    ...candidates
      .filter((player) => player.id !== actor.id)
      .map((player) => game.npcSuspicion.get(player.id) ?? 0),
  );
  if (
    game.day > 2 ||
    living.length <= 4 ||
    hasPublicBlack ||
    strongest >= 2.5 ||
    strongestPublic >= 2.5
  )
    return target;
  const chance = actor.npcPersonality === "慎重" ? 0.12 : 0.04;
  return random() < chance ? NO_EXECUTION_VOTE : target;
}
