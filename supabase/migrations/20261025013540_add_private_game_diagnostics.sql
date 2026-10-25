-- Private troubleshooting timeline; no automatic expiration by owner request.
-- Separate from aggregate analytics; never expose through ranking/site endpoints.
create table public.tomatobot_game_diagnostics (
  event_id uuid primary key,
  session_id uuid not null,
  boot_id uuid not null,
  sequence integer not null check (sequence > 0),
  occurred_at timestamptz not null,
  stored_at timestamptz not null default now(),
  app_version text not null check (length(app_version) <= 100),
  kind text not null check (length(kind) between 1 and 64),
  day integer not null check (day >= 0),
  phase text not null check (length(phase) <= 32),
  actor text check (length(actor) <= 16),
  content text check (length(content) <= 4000),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192),
  unique (session_id, boot_id, sequence)
);
create index tomatobot_diagnostics_session_time
  on public.tomatobot_game_diagnostics (session_id, occurred_at, sequence);
create index tomatobot_diagnostics_stored_time
  on public.tomatobot_game_diagnostics (stored_at);
alter table public.tomatobot_game_diagnostics enable row level security;
revoke all on public.tomatobot_game_diagnostics from public, anon, authenticated;
grant select, insert on public.tomatobot_game_diagnostics to service_role;
comment on table public.tomatobot_game_diagnostics is
  '運営用試合ログ。試合中と終了後最大3分の参加者発言・Bot公開発言・進行。保存期限なし。公開APIへの提供禁止。';
