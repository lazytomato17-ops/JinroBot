-- Supabase's default privileges may grant service_role ALL on new tables.
-- Explicitly remove those defaults on this table only, then restore what the
-- append-only diagnostic writer needs (ON CONFLICT DO NOTHING, no UPDATE).
revoke all on public.tomatobot_game_diagnostics from service_role;
grant select, insert on public.tomatobot_game_diagnostics to service_role;
