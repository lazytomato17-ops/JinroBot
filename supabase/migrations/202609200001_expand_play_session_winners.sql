-- 旧版の実プレイ役職を復活させるため、匿名プレイ分析だけ第三陣営の
-- 決着を保存できるようにする。追加役職入りの試合はランキング対象外。
alter table public.tomatobot_play_sessions
  drop constraint if exists tomatobot_play_sessions_winner_check;

alter table public.tomatobot_play_sessions
  add constraint tomatobot_play_sessions_winner_check
  check (winner in ('villager', 'wolf', 'fox', 'lovers', 'teruteru'));
