# JinroBot May 14 runtime

Render's Docker image runs the gameplay source from `33011bdaf975b4871ed745071588a0d28f220470`, before the ghost-bet balance change. The newer engine, telemetry and migrations remain in the repository so a revert of the release PR restores the newer runtime.

- Ranked matches need two human players. A correct ghost bet directly changes rating: +5 / +10 for a winner, +12 / +20 mitigation for a loser (resulting loss delta capped at +3). No TP.
- The runtime uses the existing legacy rating tables and the existing server-side Supabase secret. Apply `202611100001_protect_legacy_player_records.sql` before deploying. Neither old nor modern records are transferred or reset.
- No automatic rating resets, scheduled announcements, legacy global administration, external AI requests or raw transcript export to Supabase. NPC fallback and post-match game action summaries remain.
- `/api/rankings` and `/ranking` still serve the opt-in monthly ranking from the newer engine. The legacy match rating and modern website ranking are separate; legacy matches do not feed that monthly board.

Validation: from this directory run `npm ci --ignore-scripts`, `npm run build` and `npm run smoke`. The smoke check mocks Discord and Supabase and blocks network access.
