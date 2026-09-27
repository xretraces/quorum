-- Private questionnaire answers + the new lobby -> vote -> final plan flow. NOT applied yet: run it once in
-- Supabase Dashboard > SQL Editor (or `supabase db push`). Re-runnable.
--
-- Privacy model (still no login): each member's answers live in `member_prefs`, which has RLS on and NO
-- policies, and anon/authenticated have no table grants. So no browser can select, insert, update or delete
-- rows, and Realtime can't stream them. A browser proves it owns a member with a random token that
-- `claim_member` hands out exactly once per member (right after joining) and that is kept in that phone's
-- localStorage. The owner reads/writes only through the SECURITY DEFINER functions below, which check the
-- token. The make-plan Edge Function reads everyone's answers with the service role (bypasses RLS).
-- Other members only see `members.prefs_ready` (the lobby checkmark).

-- ---------------------------------------------------------------- private answers
create table if not exists public.member_prefs (
  member_id  uuid primary key references public.members(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  token      uuid not null default gen_random_uuid(),
  prefs      jsonb,  -- Preferences (supabase/functions/_shared/preferences.ts); null until first save
  updated_at timestamptz not null default now()
);
create index if not exists member_prefs_group_idx on public.member_prefs(group_id);
alter table public.member_prefs enable row level security;
-- Deliberately no policies. Belt and braces: no table privileges for client roles either.
revoke all on public.member_prefs from anon, authenticated;

-- Public "ready" checkmark (the only thing other members learn about someone's answers).
alter table public.members add column if not exists prefs_ready boolean not null default false;

-- Grok Imagine picture per plan card (recap-image with plan_id). groups.recap_image_url stays for the winner.
alter table public.plans add column if not exists recap_image_url text;

-- New terminal status: a plan won the vote (no payments any more).
alter table public.groups drop constraint if exists groups_status_check;
alter table public.groups add constraint groups_status_check
  check (status in ('planning','voting','decided','holding','captured','partially_captured','cancelled'));

-- ---------------------------------------------------------------- owner-only access (token checked)
-- Hands out the member's secret token. Works once per member: the first caller (the joining phone) owns it.
create or replace function public.claim_member(p_member_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_token uuid;
begin
  select group_id into v_group from public.members where id = p_member_id;
  if v_group is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  insert into public.member_prefs (member_id, group_id) values (p_member_id, v_group)
  on conflict (member_id) do nothing
  returning token into v_token;
  if v_token is null then
    raise exception 'This member was already claimed on another device' using errcode = '42501';
  end if;
  return v_token;
end $$;

create or replace function public.save_my_prefs(p_member_id uuid, p_token uuid, p_prefs jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' or pg_column_size(p_prefs) > 8000 then
    raise exception 'Answers must be a small JSON object' using errcode = '22023';
  end if;
  update public.member_prefs set prefs = p_prefs, updated_at = now()
  where member_id = p_member_id and token = p_token;
  if not found then
    raise exception 'Not your answers' using errcode = '42501';
  end if;
  update public.members set prefs_ready = true where id = p_member_id;
end $$;

create or replace function public.get_my_prefs(p_member_id uuid, p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select prefs from public.member_prefs where member_id = p_member_id and token = p_token;
$$;

revoke all on function public.claim_member(uuid) from public;
revoke all on function public.save_my_prefs(uuid, uuid, jsonb) from public;
revoke all on function public.get_my_prefs(uuid, uuid) from public;
grant execute on function public.claim_member(uuid) to anon, authenticated;
grant execute on function public.save_my_prefs(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.get_my_prefs(uuid, uuid) to anon, authenticated;
