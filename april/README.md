# April 17 JinroBot release

Gameplay and NPC voting come from `b2c12fa`. The original Rust engine is built
as a locked N-API module. Ranked rating uses the May 14 `33011bd` arithmetic
with a 1–5 point random adjustment. A correct ghost bet adds 5 or 10 points
for a winner, or offsets 12 or 20 points for a loser (maximum net +3). April
role and win rules still decide who won. There is no TP.

The existing Discord slash commands, Supabase access configuration, and opt-in
website ranking are retained. No migration or rating reset is needed. The old
automatic season reset, verification, self-ping, global admin and external AI
are not enabled. Player-created base channels and their permissions are not
changed by the bot; temporary role rooms stay separate.

Run `docker build .` to compile the native engine and exercise the exact
production image inputs offline. The May runtime remains in `legacy/` and can
be restored by reverting this release.
