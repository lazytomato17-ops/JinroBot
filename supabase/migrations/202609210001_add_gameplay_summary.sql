-- Privacy-preserving match telemetry for release and role-balance analysis.
-- The bot stores aggregate counts only. Player IDs, display names, assigned
-- roles, votes, action targets, and messages are intentionally excluded.

alter table public.tomatobot_play_sessions
  add column if not exists gameplay_summary jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tomatobot_play_sessions_gameplay_summary_check'
      and conrelid = 'public.tomatobot_play_sessions'::regclass
  ) then
    alter table public.tomatobot_play_sessions
      add constraint tomatobot_play_sessions_gameplay_summary_check
      check (
        gameplay_summary is null or (
          jsonb_typeof(gameplay_summary) = 'object' and
          gameplay_summary @> '{"schema": 1}'::jsonb and
          octet_length(gameplay_summary::text) <= 20000
        )
      );
  end if;
end
$$;

create index if not exists tomatobot_play_sessions_release_completed_idx
  on public.tomatobot_play_sessions (app_version, finished_at desc)
  where status = 'completed';

revoke all on table public.tomatobot_play_sessions from anon, authenticated;
grant all on table public.tomatobot_play_sessions to service_role;
