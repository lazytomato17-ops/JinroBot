alter table public.tomatobot_match_feedback
  add column npc_detail text check (npc_detail in ('unfair','inconsistent','unresponsive','repetitive','unspecified')),
  add column experience_context jsonb check (experience_context is null or (jsonb_typeof(experience_context) = 'object' and octet_length(experience_context::text) <= 1024));

-- Keep the existing RPC and its first-response-wins locking semantics intact.
-- This wrapper adds bounded game context only to a newly created response.
create function public.tomatobot_submit_experience_feedback(
  p_session_id uuid, p_participant_hash text, p_rating text, p_reason text,
  p_comment text, p_npc_detail text, p_context jsonb
)
returns table(outcome text, locked_rating text)
language plpgsql security invoker set search_path = ''
as $$
declare v_outcome text; v_rating text;
begin
  if p_npc_detail is not null and
    (p_reason is distinct from 'npc' or p_npc_detail not in ('unfair','inconsistent','unresponsive','repetitive','unspecified')) then
    raise exception 'invalid NPC feedback detail';
  end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object' or octet_length(p_context::text) > 1024 then
    raise exception 'invalid experience context';
  end if;
  if exists (select 1 from jsonb_object_keys(p_context) as k(key) where key not in ('role','humans','npcs','profile')) or
    not (p_context ?& array['role','humans','npcs','profile']) or
    jsonb_typeof(p_context->'role') is distinct from 'string' or
    jsonb_typeof(p_context->'profile') is distinct from 'string' or
    jsonb_typeof(p_context->'humans') is distinct from 'number' or
    jsonb_typeof(p_context->'npcs') is distinct from 'number' or
    (p_context->>'profile') not in ('basic','special') or
    (p_context->>'humans') !~ '^[0-9]{1,2}$' or (p_context->>'npcs') !~ '^[0-9]{1,2}$' or
    (p_context->>'role') not in ('unknown','村人','人狼','占い師','霊能者','騎士','狂人','共有者','検死官','タフガイ','逃亡者','暗殺者','猫又','方位磁針','狼憑き','呪われた村人','パン屋','市長','怪盗','狂信者','妖術師','分断者','饒舌な人狼','妖狐','キューピッド','純愛者','てるてる') then
    raise exception 'invalid experience fields';
  end if;
  if (p_context->>'humans')::integer not between 1 and 15 or
    (p_context->>'npcs')::integer not between 0 and 14 or
    (p_context->>'humans')::integer + (p_context->>'npcs')::integer not between 4 and 15 then
    raise exception 'invalid experience player counts';
  end if;
  select f.outcome, f.locked_rating into v_outcome, v_rating
    from public.tomatobot_submit_match_feedback(p_session_id,p_participant_hash,p_rating,p_reason,p_comment) as f;
  if v_outcome = 'created' then
    update public.tomatobot_match_feedback set npc_detail=p_npc_detail, experience_context=p_context
      where session_id=p_session_id and participant_hash=p_participant_hash;
  end if;
  return query select v_outcome, v_rating;
end;
$$;
revoke execute on function public.tomatobot_submit_experience_feedback(uuid,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.tomatobot_submit_experience_feedback(uuid,text,text,text,text,text,jsonb) to service_role;
