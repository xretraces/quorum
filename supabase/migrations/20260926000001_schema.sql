-- Plan & Pay: Supabase Postgres schema (HackGT 13 demo)
-- Run once in Supabase Dashboard > SQL Editor (or `supabase db push` as a migration).
-- Re-runnable: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- !!! DEMO SECURITY NOTE !!!
-- RLS is ENABLED, but the policies below are deliberately PERMISSIVE so a hackathon
-- demo works with no login: anyone holding the publishable/anon key can read everything
-- and create/update groups, members, and plans. `payments` is READ-ONLY for clients; only the
-- `pay` Edge Function (service role / secret key, which bypasses RLS) writes it.
-- The Edge Functions re-check money state against Stripe before capturing, so a client
-- that edits `members.approved` cannot move money on its own. It can still grief a demo.
-- Before any real use: add Supabase Auth, tie members to auth.uid(), and tighten policies.

-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- ---------------------------------------------------------------- groups
create table if not exists public.groups (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 80),
  invite_code      text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  status           text not null default 'planning'
                   check (status in ('planning','voting','holding','captured','partially_captured','cancelled')),
  transcript       text,                       -- pasted chat / voice-note transcript
  selected_plan_id uuid,                       -- FK added below (circular with plans)
  recap_image_url  text,                       -- optional Grok Imagine recap
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------- members
create table if not exists public.members (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references public.groups(id) on delete cascade,
  display_name          text not null check (char_length(display_name) between 1 and 80),
  is_organizer          boolean not null default false,
  budget_cap_cents      integer check (budget_cap_cents is null or budget_cap_cents >= 0), -- per-person cap
  cap_source            text not null default 'member' check (cap_source in ('member','grok')),
  dietary               text,
  availability          text,
  location              text,
  transport             text,
  constraints           jsonb not null default '{}'::jsonb,  -- raw Grok extraction for this member
  vote_plan_id          uuid,                                -- FK added below
  approved              boolean not null default false,
  approved_amount_cents integer check (approved_amount_cents is null or approved_amount_cents >= 0),
  approved_at           timestamptz,
  created_at            timestamptz not null default now(),
  unique (group_id, display_name)
);
create index if not exists members_group_idx on public.members(group_id);

-- ---------------------------------------------------------------- plans
create table if not exists public.plans (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references public.groups(id) on delete cascade,
  option_index          smallint not null check (option_index between 0 and 2),
  title                 text not null,
  summary               text,
  items                 jsonb not null,        -- [{catalog_id, name, start_time, note, price_per_person_cents}]
  per_person_cents      integer not null check (per_person_cents >= 0),  -- server-recomputed from catalog
  total_cents           integer not null check (total_cents >= 0),
  fits_everyone         boolean not null,
  over_cap_member_ids   uuid[] not null default '{}',
  member_notes          jsonb not null default '[]'::jsonb,
  why_it_works          text,
  reasoning             text,
  server_warnings       jsonb not null default '[]'::jsonb,  -- where the server corrected the model
  model                 text,
  raw                   jsonb,                 -- full validated model output (debug)
  created_at            timestamptz not null default now(),
  unique (group_id, option_index)
);
create index if not exists plans_group_idx on public.plans(group_id);

-- ---------------------------------------------------------------- payments
create table if not exists public.payments (
  id                        uuid primary key default gen_random_uuid(),
  group_id                  uuid not null references public.groups(id) on delete cascade,
  member_id                 uuid not null references public.members(id) on delete cascade,
  plan_id                   uuid not null references public.plans(id), -- NO ACTION: can't delete a plan that has payments,
                                                                       -- but deleting the whole group still cascades cleanly
  stripe_payment_intent_id  text not null unique,
  amount_cents              integer not null check (amount_cents >= 50),  -- Stripe USD minimum is $0.50
  currency                  text not null default 'usd',
  -- Mirrors Stripe PaymentIntent.status (requires_payment_method, requires_confirmation,
  -- requires_action, processing, requires_capture, canceled, succeeded).
  status                    text not null,
  over_cap_reapproved       boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (member_id, plan_id)
);
create index if not exists payments_group_idx on public.payments(group_id);

-- ---------------------------------------------------------------- circular FKs
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'groups_selected_plan_fk') then
    alter table public.groups add constraint groups_selected_plan_fk
      foreign key (selected_plan_id) references public.plans(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'members_vote_plan_fk') then
    alter table public.members add constraint members_vote_plan_fk
      foreign key (vote_plan_id) references public.plans(id) on delete set null;
  end if;
end $$;

-- keep payments.updated_at fresh
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS (PERMISSIVE, DEMO ONLY)
alter table public.groups   enable row level security;
alter table public.members  enable row level security;
alter table public.plans    enable row level security;
alter table public.payments enable row level security;

drop policy if exists demo_groups_all  on public.groups;
drop policy if exists demo_members_all on public.members;
drop policy if exists demo_plans_all   on public.plans;
drop policy if exists demo_payments_read on public.payments;

create policy demo_groups_all  on public.groups  for all to anon, authenticated using (true) with check (true);
create policy demo_members_all on public.members for all to anon, authenticated using (true) with check (true);
create policy demo_plans_all   on public.plans   for all to anon, authenticated using (true) with check (true);
-- payments: clients may only READ. Writes happen in the `pay` function with the service role.
create policy demo_payments_read on public.payments for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- Realtime
-- Adds members, plans, payments to the Supabase Realtime publication, plus groups
-- (so clients see status and selected_plan_id changes). Skips tables that are already added.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;  -- exists by default on Supabase; this is for local PG
  end if;
  foreach t in array array['members','plans','payments','groups'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
