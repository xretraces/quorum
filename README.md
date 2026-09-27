# Quorum

*Everyone answers privately. Grok finds the plan that works for all of you.*

Live: https://quorum-eight-mu.vercel.app · Built at HackGT 13.

The creator makes a group and shows a big **QR code** (or copies/shares the link). Friends scan it and join with just a name; the lobby shows them appearing live. Each person fills a short **private questionnaire** with four fields: **Budget** (max $ per person), **Dietary**, **Availability** and **Other**. A blank field means "no preference". Instead of typing into each field, they can **tell Grok about themselves** in one sentence, spoken (🎙 Speak, transcribed by **Grok Voice**) or typed, and Grok fills the four fields for them to check and edit. **Only Grok sees the answers**; everyone else just sees a ✓ Ready checkmark. When everyone is ready (or at least 2 people are and the creator taps "Plan it anyway"), the creator taps **Ask Grok**. The `make-plan` function reads the answers server-side and returns 2-3 real Atlanta plans. Budget is a hard per-person cap, hard no's are strict exclusions, and vegetarian or gluten-free answers mean only suitable food stops; the server re-checks all of them. Each card shows **real photos of the venues** (freely licensed photos or the venue's own photo, always credited; a free stock photo only if a place had none, Grok Imagine only as a last resort), a group-level "why it fits" line that never names anyone, and labels like "Fits everyone" / "Cheapest". Everyone taps **I'm in** on one plan. Once everyone has voted, the top plan wins (the creator breaks ties) and every phone switches live to **Your plan**, with a **Grok Imagine** poster, **Add to calendar** (.ics download) and Share. Each person can pick their own **language** from the switcher in the corner (9 languages, including right-to-left Arabic); the UI changes instantly and Grok translates the plans for them.

**Shipped and live:** Tell Grok about yourself (speak via Grok Voice or type; Grok fills the form), gluten-free as a real plan check, and the language switcher with Grok-translated plans (9 languages, including right-to-left Arabic).

## Built with Grok

| Grok product | Where it's used |
| --- | --- |
| **Grok models** (xAI API, strict JSON-schema output) | Plans: `make-plan` turns everyone's anonymized answers into 2-3 plans. Parsing: `parse-prefs` turns a spoken or typed sentence into the four questionnaire fields. Translation: `translate-plan` translates each plan's text for the language switcher (cached per plan and language); the UI strings in 8 languages were also pre-translated by Grok (`scripts/translate-i18n.mjs`) |
| **Grok Imagine** | The winning plan's poster (`recap-image`). Venue cards never default to AI: every venue has a real photo of the place, and Grok Imagine is only a logged last resort after stock photos (`lib/venuePhotos.ts`) |
| **Grok Voice** | Spoken answers for the questionnaire: the "Tell Grok about yourself" box records a short voice note, the `transcribe` function sends it to Grok Voice speech-to-text (`grok-voice-transcribe-2.0`, xAI `/v1/stt`), then `parse-prefs` fills the form |

Built with **Cursor** and **Claude Code**.

## Stack

- **Web:** React 19 + Vite + TypeScript + Tailwind v4 at the repo root (`src/`), `@supabase/supabase-js`, `qrcode.react`
- **Backend:** Supabase Postgres + Realtime + Edge Functions (Deno): `make-plan`, `parse-prefs`, `transcribe`, `recap-image`, `translate-plan`
- **AI:** xAI Grok models (strict JSON-schema output), Grok Voice (speech-to-text) and Grok Imagine
- **Hosting:** Vercel (web; `vercel.json` has the SPA rewrite) + Supabase (functions)

## Quickstart

```bash
git clone <this repo> quorum && cd quorum
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (publishable key) are pre-filled
npm run dev                  # http://localhost:5173
```

Create a group, then open the invite link (or enter the invite code on the home screen) in a second browser or an incognito window to join as another person. There's no login: each browser stores its member id per group in `localStorage` (`pp:member:<groupId>`) and the token for its private answers (`pp:token:<memberId>`).

`npm run build` type-checks (`tsc -b`) and builds. `npm run lint` runs ESLint on the web app. `npm test` runs the voice unit tests (Node 22+, `--experimental-strip-types`). Optional: `VITE_PUBLIC_URL` changes where invite links and the QR code point (defaults to the live site). `VITE_VOICE_PARALLEL` (`auto`, the default, means laptops only; or `on`/`off`) also runs the browser's speech recognition during a Grok Voice take as a backup transcript.

## Repo layout

```
src/                     React app
  components/            CreateGroup (home: create + join by code), YourGroups, JoinGroup, GroupBoard, Lobby,
                         Questionnaire, VoiceFill, VoiceButton, GrokWorking, PlanCard, VenuePhotos, FinalPlan, Recap,
                         LanguageSwitcher
  i18n/                  en.json (source of truth) + 8 translated JSON files, LanguageProvider, useT(), usePlanTranslation
  lib/supabase.ts        client, invoke() helper, types, localStorage identity helpers
  lib/prefs.ts           private answers: claim_member / save_my_prefs / get_my_prefs RPCs
  lib/parsePrefs.ts      client for the parse-prefs function
  lib/voice.ts           mic recording, silence detection, transcribe client, browser speech fallback
  lib/voice-logic.ts     pure voice decisions (which transcript wins, fallbacks) + tests
  lib/voiceFill.ts       merge rule for "Tell Grok about yourself" (fields Grok heard replace, `other` appends) + tests
  lib/calendar.ts        .ics export for the winning plan
  lib/fallback.ts        saved demo plans, used only if the make-plan call fails
supabase/
  functions/             make-plan, parse-prefs, transcribe, recap-image, translate-plan + _shared (plan rules, preferences, stt, generated catalog)
  migrations/            schema + private answers (see Database)
  config.toml            verify_jwt = false for every function
data/                    atlanta-activities.json (venue catalog; prices are approximate demo data, gf_friendly notes, photo credits)
public/venues/           venue pictures shown on plan cards
scripts/sync-shared.sh   regenerate supabase/functions/_shared/catalog.ts (and friends) after editing data/
docs/TEAM_SPEC.md        original product spec (screens/flow/UX; ignore its Express/Firebase backend)
```

`prompts/`, `schema/` and `tools/prompt-tests/` hold an earlier planning prompt, its schema and its tests. The current `make-plan` doesn't use them; its prompt and schema live in `supabase/functions/_shared/prefsPlan.ts`. A few other files left over from an earlier prototype are not used by the app either.

## Database

Project ref **`oavxpwpdhdazhtieikju`**. All migrations in `supabase/migrations/` are **already applied** to the live database, including `20260927000001_private_prefs.sql` (private `member_prefs` + RPCs, `members.prefs_ready`, `plans.recap_image_url`, `groups.status` value `decided`) and `20260927000002_plan_translations.sql` (`plans.translations`). The files are here for reference and for fresh projects.

- `groups`: name, `invite_code`, `status` (`planning` → `voting` → `decided`), `selected_plan_id`, `recap_image_url`.
- `members`: `display_name`, `is_organizer`, `prefs_ready` (the public ✓), `vote_plan_id`.
- `plans`: 2-3 per group from `make-plan` (items, per-person and total price, `why_it_works`, `model`), plus `translations` (Grok's cached translations of the plan text, keyed by language).
- `member_prefs`: each person's private answers (see Privacy).

`groups`, `members` and `plans` have permissive demo RLS and Realtime on, so every phone updates live.

## How the flow maps to the code

| Step | Where |
| --- | --- |
| Create (group + your name) / join (name only) | `CreateGroup.tsx`, `JoinGroup.tsx` (both call `claimMember`) |
| Lobby: QR, Copy link, Share, live members + ready checks | `Lobby.tsx` (`qrcode.react`, Realtime on `members`) |
| Private questionnaire (Budget, Dietary, Availability, Other) | `Questionnaire.tsx` + `lib/prefs.ts` (`save_my_prefs` / `get_my_prefs` RPCs) |
| Tell Grok about yourself (speak or type) | `VoiceFill.tsx` at the top of the form: `VoiceButton` → `transcribe` (Grok Voice) → `parse-prefs` → `lib/voiceFill.ts` merges into the form via `applyPreferences`. Nothing is saved until the person taps I'm ready |
| Ask Grok / Plan it anyway (creator) | `GroupBoard.askGrok()` → `make-plan { group_id }` + the shared "Grok is working" card (`GrokWorking.tsx`) |
| Plans from private answers | `make-plan` + `_shared/prefsPlan.ts` (anonymized Grok call, server re-checks, backup plans) |
| Venue pictures per plan card | `VenuePhotos.tsx` + `lib/venuePhotos.ts` (order: real photo of the place > free stock photo > Grok Imagine as a logged last resort); `photos` / `stock_photos` in `data/atlanta-activities.json`, images in `public/venues/` (Wikimedia Commons / Flickr free licenses or the venue's own photo, all credited; CC0 StockSnap stock per category) |
| Vote, live counts, winner, tie-break | `PlanCard.tsx`, `tally()` in `GroupBoard.tsx` (`members.vote_plan_id`, `groups.selected_plan_id`, status `decided`) |
| Grok Imagine poster for the winning plan | `Recap.tsx` on the final screen; the creator's phone calls `recap-image { group_id }` once the vote is decided |
| Your plan, Add to calendar, Share | `FinalPlan.tsx`, `lib/calendar.ts` (.ics) |
| Language switcher (9 languages, Arabic RTL) + translated plans | `LanguageSwitcher.tsx`, `src/i18n/` (`useT()`, `usePlanTranslation` → `translate-plan`, cached in `plans.translations`) |
| Grok down | `make-plan` builds "Backup plan"s from the same answers. If `make-plan` itself can't be reached: saved "Demo plan"s (`lib/fallback.ts`, not checked against answers because the browser can't read them) |

### Privacy of answers

Answers live in `member_prefs`: RLS on, **no policies**, no grants for `anon`/`authenticated`, not in Realtime. A phone proves it owns its member with a token from `claim_member` (handed out once per member, stored in that phone's `localStorage`) and reads/writes only through `save_my_prefs` / `get_my_prefs`. `make-plan` reads everyone's answers with the service role. Grok sees them as "Person 1..N"; plan rows store no per-member notes and no raw model output, and plan text that mentions a name or a dollar amount is replaced by a server-written line. Without login this is still demo-grade: whoever claims a member first owns it.

### make-plan

`POST /functions/v1/make-plan { group_id }` → `{ plans, model, source: "grok" | "backup", answered, notice }`. Needs answers from at least 2 members (1 in a solo group). Hard rules checked in code: sum of catalog prices ≤ the lowest budget, no item matching a hard no from "Other" (name/category/tags plus aliases like heights → rooftop/summit), veg-friendly food if anyone is vegetarian/vegan, gluten-free-friendly food (`gf_friendly` in the catalog) if anyone is gluten-free or celiac, transit-friendly stops if anyone takes MARTA or has no car (unless they mention rideshare), and every stop inside the shared free window from "Availability" and the venue's typical hours. Gluten-free is detected per clause ("not gluten free" and "my gf" don't count). If fewer than 2 GF-friendly food stops also pass the other rules, the rule softens: any food is allowed and the plan says "Check gluten-free options with the venue before you go." Plans that fail are dropped; if none survive or Grok fails, deterministic backup plans are built from the same rules. 422 if nothing in the catalog fits. Grok gets about 110 s in total before the backup plans take over.

### parse-prefs (spoken or typed sentence → questionnaire)

`POST /functions/v1/parse-prefs { transcript: string, current?: Partial<Preferences> }` → `{ preferences: Partial<Preferences>, heard: string }`, with only the fields the person mentioned. `Preferences` (in `supabase/functions/_shared/preferences.ts`) has the same four fields as the form:

| Field | Type | Example |
| --- | --- | --- |
| `budget` | number or null, max $ per person (clamped 0-1000) | "about 35 bucks" → `35` |
| `dietary` | text: diet, allergies, cravings | "vegetarian, no peanuts" |
| `availability` | text, in the person's words | "Saturday after 2pm" |
| `other` | text: getting around, hard no's, anything else | "I take MARTA, no bars" |

Values come back in English with digit times ("after six" → "after 6pm") so make-plan's rules can read them, even when the person spoke another language. It uses the same `GROK_API_KEY` / `GROK_MODEL` secrets as make-plan. Without a key, or if Grok fails, it returns a basic regex parse (dollar amount, diet keywords, availability phrase, full transcript in `other`) instead of an error. Empty transcripts get a 400; transcripts are cut to 2000 chars. Client: `parsePrefs(transcript, current?)` in `src/lib/parsePrefs.ts`, called by `VoiceFill.tsx`. Older saved answers (`food`, `hardNos`, `transport`, `freeFrom`/`freeUntil`) are folded into the four fields by `normalizePrefs`.

### transcribe (Grok Voice)

`POST /functions/v1/transcribe { audio_base64: string, mime_type?: string, keyterms?: string[] }` → `{ text, language, duration, model }`. Sends the voice note (up to about 45 s, 4 MB) to Grok Voice speech-to-text (`https://api.x.ai/v1/stt`, `GROK_STT_MODEL`, default `grok-voice-transcribe-2.0`) with keyterms for budgets, diets, MARTA and the catalog's venue names. 422 if it heard silence, 502 if xAI fails. The xAI key stays on the server. In the browser (`VoiceButton` + `lib/voice.ts`), tap 🎙 Speak and tap Stop, or it stops after about 2.5 s of silence. If Grok Voice fails, the browser's own speech recognition takes over.

### recap-image

`POST /functions/v1/recap-image { group_id, plan_id? }` → `{ url, prompt }`. Paints the selected plan (or `plan_id`) with Grok Imagine (`GROK_IMAGE_MODEL`, default `grok-imagine-image-2.0`) and stores the URL on the group (or plan). Image URLs from xAI may be temporary.

## Deploy edge functions (Supabase CLI)

```bash
npx supabase login
npx supabase link --project-ref oavxpwpdhdazhtieikju

# Server secrets live ONLY in Supabase function secrets (never in .env files or the repo)
npx supabase secrets set GROK_API_KEY=xai-...
# optional: GROK_MODEL=grok-4.7  GROK_IMAGE_MODEL=grok-imagine-image-2.0  GROK_STT_MODEL=grok-voice-transcribe-2.0

npx supabase functions deploy make-plan   --no-verify-jwt
npx supabase functions deploy parse-prefs --no-verify-jwt
npx supabase functions deploy transcribe  --no-verify-jwt
npx supabase functions deploy recap-image --no-verify-jwt
npx supabase functions deploy translate-plan --no-verify-jwt
# No Docker? add --use-api
```

`SUPABASE_URL` and the service keys are injected automatically; don't set anything that starts with `SUPABASE_`. `--no-verify-jwt` is needed because `sb_publishable_` keys aren't JWTs (also set in `supabase/config.toml`); the functions check for the project's publishable key instead. That check is not auth, which is fine for a demo.

After editing `data/atlanta-activities.json`, run `./scripts/sync-shared.sh` and commit the regenerated `supabase/functions/_shared/catalog.ts`.

Local function checks (Deno 2):

```bash
export DENO_NO_PACKAGE_JSON=1   # keep Deno from reading the web app's package.json
deno check --node-modules-dir=none supabase/functions/*/index.ts
deno lint supabase/functions
deno test --node-modules-dir=none supabase/functions/_shared/logic.test.ts supabase/functions/_shared/prefsPlan.test.ts supabase/functions/_shared/stt.test.ts
```

## Deploy web (Vercel)

Import the repo → framework **Vite** → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the `sb_publishable_` key) → Deploy. `vercel.json` rewrites everything to `index.html`, so `/join/<code>` and `/g/<id>` deep links work.

## Branch workflow

`main` stays demoable. Everyone works on their own branch (one git worktree per branch works well) and opens small PRs into `main`. Pull `main` often. Conflict hot spots: `GroupBoard.tsx` and `supabase/functions/_shared/`.

## Demo script (2–3 min)

**0:00, the hook.** "Every friend group has this: nobody wants to say *I can only spend $35* or *I don't have a car* in front of everyone, so the plan ends up working for the loudest person. Quorum lets everyone answer privately, and Grok finds the plan that fits the whole group."

**0:20, QR lobby.** The creator makes "Saturday hang" and the lobby shows a big QR code. Two judges scan it with their phone camera, no app needed, join with just a name, and pop up in the member list live.

**0:40, private answers.** Each phone fills the four fields: Budget, Dietary, Availability, Other (blank = no preference). For example: "$35, vegetarian, no car" · "$80, free after 5 PM Saturday, I have a car" · "$40, gluten-free, I take MARTA". One judge taps **🎙 Speak** in the "Tell Grok about yourself" box and says it instead (or types it): Grok Voice transcribes it and Grok fills the four fields, marked "Filled by Grok — check and edit". Point out the 🔒 "Only Grok sees this" note: everyone else only sees a ✓ Ready checkmark. Have one judge switch their phone to Español or العربية from the language switcher: the whole UI flips (Arabic right-to-left), and later their plans arrive translated by Grok.

**1:05, Grok plans.** The creator taps **Ask Grok**. Every phone shows the "Grok is working" card. 20-90 s later, 2-3 real Atlanta plans appear with venue pictures and a "why it fits" line that names nobody. Point out that every plan is under the lowest budget (the server re-checks Grok's math against the catalog prices), uses veg-friendly food, only picks food stops with gluten-free options, and only uses places reachable by MARTA, and that nothing reveals whose constraint was whose.

**1:40, vote.** Everyone taps **I'm in** on their favorite; counts update live on every phone. When everyone has voted, the top plan wins (the creator breaks ties).

**2:00, winner poster and calendar.** Every phone flips to **Your plan**: a **Grok Imagine** poster of the day, the itinerary with times, **Add to calendar** (.ics) and Share. Close: "Everyone got a say, nobody had to overshare, and the plan actually fits."

**If Grok is slow or down on stage:** `make-plan` falls back to backup plans built from the same answers and rules, and if the function can't be reached at all, the app shows saved demo plans with a banner. A pre-made group with answers already in keeps the demo short.

## Security notes (demo)

RLS is permissive on `groups`, `members` and `plans` so the demo works without login (see the header of `supabase/migrations/20260926000001_schema.sql`); private answers are locked down as described above. The publishable key and Supabase URL are public by design. Never commit `xai-` or service-role keys. Before real use: add Supabase Auth, tie members to `auth.uid()` and tighten policies.

## Languages (i18n)

**Shipped.** A language switcher (`src/components/LanguageSwitcher.tsx`, top-right of every screen; top-left in Arabic) translates the whole UI instantly into 9 languages:
English, Español, Français, Deutsch, Português, 中文, 한국어, हिन्दी, العربية. Arabic switches `<html dir="rtl">` and the layout mirrors
(logical `text-start`/`ms-*`/`end-*` classes, `dir="auto"` / `<bdi>` around Latin group and venue names).

- **Static UI strings** live in `src/i18n/en.json` (source of truth). `useT()` returns `t(key, vars)` with `{name}`
  placeholders and `_one`/`_other` plurals; `useLanguage()` gives `{ lang, setLang, dir }`. The choice is kept in
  localStorage (default: the browser language if supported, else English). Missing keys fall back to English.
- **Other languages** are generated by Grok and committed, so switching needs no network:
  `XAI_API_KEY=... node scripts/translate-i18n.mjs [es fr ...]` (model = make-plan's `DEFAULT_MODEL`, or `GROK_MODEL`).
  The script checks every key and `{placeholder}` survives. Re-run it after adding strings to `en.json`.
  Without `XAI_API_KEY` it uses the temporary `gen-assets` Edge Function (token from `GEN_ASSETS_TOKEN` or
  `~/.gen-assets-token`), which calls Grok with the project's `GROK_API_KEY` secret.
- **Dynamic Grok text** (plan titles, "why it fits", stop notes, transit tips) is translated on demand by the
  `translate-plan` Edge Function and cached in `plans.translations` (migration `20260927000002_plan_translations.sql`).
  English shows (with a shimmer) until the translation arrives, and stays if translation fails. Venue names and prices are never translated.
  translate-plan only reads plan text (title, summary, why it fits, stop notes), never anyone's private answers.
