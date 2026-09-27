-- Cached Grok translations of a plan's text fields, keyed by language code:
--   { "es": { "title": "...", "summary": "...", "why_it_works": "...", "items": [{ "note": "...", "transit_note": "..." }] } }
-- Written only by the translate-plan Edge Function (service role). Clients read it with the rest of the plan row,
-- and Realtime pushes the update, so every phone in the group gets a translation once anyone asks for it.
-- Venue names are never translated. New plans (make-plan inserts fresh rows) start with no translations.

alter table public.plans add column if not exists translations jsonb not null default '{}'::jsonb;

-- Merge one language in atomically, so two languages translated at once don't overwrite each other.
create or replace function public.set_plan_translation(p_plan_id uuid, p_lang text, p_translation jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.plans
     set translations = coalesce(translations, '{}'::jsonb) || jsonb_build_object(p_lang, p_translation)
   where id = p_plan_id;
$$;

revoke all on function public.set_plan_translation(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_plan_translation(uuid, text, jsonb) to service_role;
