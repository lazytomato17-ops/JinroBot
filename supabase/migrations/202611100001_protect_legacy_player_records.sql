-- The restored engine resumes writing to these historical tables. Do not
-- expose new Discord IDs, linked individual roles, or private presets.
-- The website reads the separate tomatobot_public_rankings RPC.
revoke all on table public.users, public.match_players, public.presets
  from public, anon, authenticated;
