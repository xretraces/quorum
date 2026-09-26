-- Live group chat (team spec Screen 4). Permissive RLS for demo, realtime enabled.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  member_id   uuid references public.members(id) on delete set null,
  sender_name text not null check (char_length(sender_name) between 1 and 80),
  text        text not null check (char_length(text) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists messages_group_created_idx on public.messages(group_id, created_at);
alter table public.messages enable row level security;
drop policy if exists demo_messages_all on public.messages;
create policy demo_messages_all on public.messages for all to anon, authenticated using (true) with check (true);
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
