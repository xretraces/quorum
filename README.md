# Quorum

*Everyone answers privately. Grok finds the plan that works for all of you.*

The creator makes a group and shows a big **QR code** (or copies/shares the link). Friends scan it and join with just a name; the lobby shows them appearing live. Each person fills a short **private questionnaire** (budget, food, getting there, when they're free, hard no's, anything else). **Only Grok sees the answers**; everyone else just sees a ✓ Ready checkmark. When everyone is ready (or at least 2 and the creator taps "Plan it anyway"), the creator taps **Ask Grok**. The `make-plan` function reads the answers server-side and returns 2-3 real Atlanta plans; budget is a hard per-person cap and hard no's are strict exclusions, re-checked by the server. Each card shows **real photos of the venues** (freely licensed, from Wikimedia Commons), a group-level "why it fits" line that never names anyone, and labels like "Fits everyone" / "Cheapest". Everyone taps **I'm in** on one plan; once everyone has voted the top plan wins (the creator breaks ties) and every phone switches live to **Your plan** with a **Grok Imagine** poster and **Add to calendar**. No chat, no payments. Built at HackGT 13.

## Stack

- **Web:** React 19 + Vite + TypeScript + Tailwind v4 at the repo root (`src/`), `@supabase/supabase-js`, Stripe Payment Element
- **Backend:** Supabase Postgres + Realtime + Edge Functions (Deno): `make-plan`, `pay`, `recap-image`
- **AI:** xAI Grok (strict JSON-schema output), optional Grok Imagine recap card
- **Payments:** Stripe **test mode** only (`capture_method=manual`)
- **Hosting:** Vercel (web; `vercel.json` has the SPA rewrite) + Supabase (functions)

## Quickstart

```bash
git clone <this repo> quorum && cd quorum
npm install
cp .env.example .env.local   # Supabase URL + publishable key are pre-filled; add your pk_test_ Stripe key
npm run dev                  # http://localhost:5173
```

Create a group, then open the invite link (or enter the group code on the home screen) in a second browser or an incognito window to join as another person. Each browser stores its `memberId` per group in `localStorage` (no login).

`npm run build` type-checks (`tsc -b`) and builds. `npm run lint` runs ESLint on the web app.

## Repo layout

```
src/                     React app
  components/            CreateGroup (home: create + join by code), JoinGroup, GroupBoard, GroupChat,
                         PlanCard, RejectButton, LockedPlan (status/booking), PayButton (kit, Stripe)
  lib/supabase.ts        client, invoke() helper, types, money + budget helpers (kit web-snippet + additions)
  lib/payments.ts        pay-function calls + simulated payments fallback (no Stripe; see "Simulated payments")
  lib/fallback.ts        saved demo plans, used only if the make-plan call fails
supabase/
  functions/             make-plan, pay, recap-image, parse-prefs + _shared (logic, tests, generated catalog/schema/prompt)
  migrations/            20260926000001_schema.sql (kit schema.sql), 20260926000002_messages.sql (group chat)
  config.toml            verify_jwt = false for every function
data/                    atlanta-activities.json (catalog; prices are approximate demo data)
prompts/                 make-plan.md (Grok system prompt, between PROMPT markers)
schema/                  plan.schema.json (strict Grok output schema)
scripts/sync-shared.sh   regenerate supabase/functions/_shared/*.ts after editing data/, schema/, prompts/
tools/prompt-tests/      run.py: live-test the Grok prompt against sample chats (Python stdlib only)
docs/TEAM_SPEC.md        original product spec (screens/flow/UX; ignore its Express/Firebase backend)
```

## Database

Project ref **`oavxpwpdhdazhtieikju`**. The first two migrations are **already applied** to the live database; the files are here for reference and for fresh projects. Don't re-run them against the shared DB (they are idempotent, but there's no need).

- **Not applied yet:** `20260927000001_private_prefs.sql` (private `member_prefs` + RPCs, `members.prefs_ready`, `plans.recap_image_url`, `groups.status` value `decided`). The new flow needs it.
- `groups`, `members`, `plans`, `payments`: kit schema, permissive demo RLS, Realtime on. `payments` is read-only for clients.
- `messages`: live group chat (`sender_name`, `text`, `created_at`), Realtime on.
- Rejections are stored in `members.constraints.rejection = { plan_id, reason, at }`, so no schema change was needed. `make-plan` overwrites `constraints`, which clears the rejection.
- Simulated holds (see below) are stored in `members.constraints.sim_payment = { plan_id, status, amount_cents, over_cap_reapproved, reason }`, again no schema change. Nothing is written to `payments`, which stays Stripe-only.

## How the flow maps to the code

| Step | Where |
| --- | --- |
| Create (group + your name) / join (name only) | `CreateGroup.tsx`, `JoinGroup.tsx` (both call `claimMember`) |
| Lobby: QR, Copy link, Share, live members + ready checks | `Lobby.tsx` (`qrcode.react`, Realtime on `members`) |
| Private questionnaire | `Questionnaire.tsx` + `lib/prefs.ts` (`save_my_prefs` / `get_my_prefs` RPCs). Voice can fill it via `ref.current.applyPreferences(partial)` |
| Ask Grok / Plan it anyway (creator) | `GroupBoard.askGrok()` → `make-plan { group_id }` + the shared "Grok is working" card |
| Plans from private answers | `make-plan` + `_shared/prefsPlan.ts` (anonymized Grok call, server re-checks, backup plans) |
| Real venue photos per plan card | `VenuePhotos.tsx`; `photo` / `photoCredit` in `data/atlanta-activities.json`, images in `public/venues/` (Wikimedia Commons, free licenses) |
| Grok Imagine poster for the winning plan | `Recap.tsx` on the final screen; the creator's phone calls `recap-image { group_id }` once the vote is decided (`plan_id` still supported) |
| Vote, live counts, winner, tie-break | `PlanCard.tsx`, `tally()` in `GroupBoard.tsx` (`members.vote_plan_id`, `groups.selected_plan_id`, status `decided`) |
| Your plan, Add to calendar, Share | `FinalPlan.tsx`, `lib/calendar.ts` (.ics) |
| Grok down | `make-plan` builds "Backup plan"s from the same answers. If `make-plan` itself can't be reached: saved "Demo plan"s (`lib/fallback.ts`, not checked against answers because the browser can't read them) |

Unused but kept: `GroupChat`, `LockedPlan`, `PayButton`, `RejectButton`, `Booked`, `YourPlan`, `CardLabel`, `lib/payments.ts`, the `pay` function, the `messages` table, and the old chat prompt/schema (`prompts/make-plan.md`, `schema/plan.schema.json`, `tools/prompt-tests`), which `make-plan` no longer uses.

### Privacy of answers

Answers live in `member_prefs` (migration `20260927000001_private_prefs.sql`): RLS on, **no policies**, no grants for `anon`/`authenticated`, not in Realtime. A phone proves it owns its member with a token from `claim_member` (handed out once per member, stored in that phone's `localStorage`) and reads/writes only through `save_my_prefs` / `get_my_prefs`. `make-plan` reads everyone's answers with the service role. Grok sees them as "Person 1..N"; plan rows store no per-member notes, no over-cap ids and no raw model output, and plan text that mentions a name or a dollar amount is replaced by a server-written line. Without login this is still demo-grade: whoever claims a member first owns it.

### make-plan

`POST /functions/v1/make-plan { group_id }` → `{ plans, model, source: "grok" | "backup", answered }`. Needs answers from at least 2 members (1 in a solo group). Hard rules checked in code: sum of catalog prices ≤ lowest budget, no item matching a hard no (name/category/tags plus a few aliases like heights → rooftop/summit), veg-friendly food if anyone is vegetarian/vegan, transit-friendly items if anyone takes MARTA or walks, every stop inside the shared free window. Plans that fail are dropped; if none survive or Grok fails, deterministic backup plans are built from the same rules. 422 if nothing in the catalog fits.

## Deploy edge functions (Supabase CLI)

```bash
npx supabase login
npx supabase link --project-ref oavxpwpdhdazhtieikju

# Server secrets live ONLY in Supabase function secrets (never in .env files or the repo)
npx supabase secrets set GROK_API_KEY=xai-... STRIPE_SECRET_KEY=sk_test_...
# optional: GROK_MODEL=grok-4.7  GROK_IMAGE_MODEL=grok-imagine-image-2.0

npx supabase functions deploy make-plan   --no-verify-jwt
npx supabase functions deploy pay         --no-verify-jwt
npx supabase functions deploy recap-image --no-verify-jwt   # optional
npx supabase functions deploy parse-prefs --no-verify-jwt
# No Docker? add --use-api
```

`pay` refuses non-test Stripe keys. Without `STRIPE_SECRET_KEY` or a deployed `pay`, the app falls back to simulated payments (below). `SUPABASE_URL` and the service keys are injected automatically; don't set anything that starts with `SUPABASE_`. `--no-verify-jwt` is needed because `sb_publishable_` keys aren't JWTs (also set in `supabase/config.toml`); the functions check for the project's publishable key instead. That check is not auth, which is fine for a demo.

### parse-prefs (voice answers -> questionnaire)

`POST /functions/v1/parse-prefs` with `{ transcript: string, current?: Partial<Preferences> }` returns `{ preferences: Partial<Preferences>, heard: string }`, with only the fields the person mentioned. `Preferences` lives in `supabase/functions/_shared/preferences.ts` (`budget` in max $ per person, `transport` one of `car | marta | rideshare | walk`, `freeFrom`/`freeUntil` as 24h `HH:MM`, plus `food`, `hardNos`, `other`). It uses the same `GROK_API_KEY` / `GROK_MODEL` secrets as make-plan; without a key, or if Grok fails, it returns a basic regex parse (dollar amount, transport and diet keywords, full transcript in `other`) instead of an error. Empty transcripts get a 400; transcripts are cut to 2000 chars. Client: `parsePrefs(transcript, current?)` in `src/lib/parsePrefs.ts`. Deploy: `npx supabase functions deploy parse-prefs --no-verify-jwt`.

Local function checks (Deno 2):

```bash
export DENO_NO_PACKAGE_JSON=1   # keep Deno from reading the web app's package.json
deno check --node-modules-dir=none supabase/functions/*/index.ts
deno lint supabase/functions
deno test --node-modules-dir=none supabase/functions/_shared/logic.test.ts
```

## Deploy web (Vercel)

Import the repo → framework **Vite** → add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY` (optionally `VITE_SIMULATE_PAYMENTS=true` for a rehearsal deploy) → Deploy. `vercel.json` rewrites everything to `index.html`, so `/join/<code>` and `/g/<id>` deep links work.

## Branch workflow (3 people)

`main` stays demoable. Each person works on their own branch and opens small PRs into `main`. Pull `main` often.

| Branch | Owner | Scope |
| --- | --- | --- |
| `backend-payments` | Person A | `supabase/` (functions, migrations), deploys, secrets, Stripe test flow end to end, RLS notes |
| `frontend-screens` | Person B | `src/components/`, mobile polish, loading and empty states, confirmation screen |
| `grok-voice-pitch` | Person C | `prompts/`, `data/`, `tools/prompt-tests/`, Grok Voice, recap image, pitch + demo rehearsal |

```bash
git checkout main && git pull
git checkout -b frontend-screens
# ...work...
git add -A && git commit -m "Polish plan cards"
git push -u origin frontend-screens   # then open a PR
```

Conflict hot spots: `GroupBoard.tsx` (A and B) and `supabase/functions/_shared/` (A and C). After editing `data/`, `schema/`, or `prompts/`, run `./scripts/sync-shared.sh` and commit the regenerated `_shared/*.ts`.

**Voice:** 🎙 currently uses the browser's Web Speech API (Chrome/Edge). **TODO (SpaceXAI challenge):** swap it for Grok Voice / xAI speech-to-text (`dictate()` in `GroupBoard.tsx`). Don't block the demo on it.

## Prompt tests

```bash
cd tools/prompt-tests
python3 run.py --dry-run           # builds the exact make-plan request; no key, no network
GROK_API_KEY=xai-... python3 run.py
```

## Stripe test cards

> Old flow (unused).

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` (Visa) | Hold succeeds (`requires_capture`). Use this one for the demo. |
| `4000 0027 6000 3184` | 3-D Secure challenge |
| `4000 0000 0000 9995` | Declined (insufficient funds) |

Any future expiry, any CVC, any ZIP. Holds show as **Uncaptured** in Stripe Dashboard (test mode) → Payments.

## Simulated payments (demo-safe fallback)

> Old flow: payments are no longer part of the app. Kept for reference.

Like the saved demo plan for Grok, "Lock & collect" has a fallback that needs no Stripe at all. It walks the same steps: each member places a hold capped at their budget, an over-cap member must tap "Approve anyway" first, the last approval captures everything, and "Cancel group" releases every hold. It uses the `pay` function's own rules (`decideHold`, `approvalCovers`, `captureReadiness` imported from `supabase/functions/_shared/logic.ts`). The card form becomes a single **Hold $X (simulated)** button, and the locked plan and confirmation show a **Simulated payment (test)** badge with the reason. No card is charged and nothing is sent to Stripe.

| Mode | How to get it |
| --- | --- |
| **Real Stripe** (default when configured) | `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…` (a real key), `pay` deployed, `STRIPE_SECRET_KEY` set, `VITE_SIMULATE_PAYMENTS` unset or `false` |
| **Forced simulation** (rehearsals) | `VITE_SIMULATE_PAYMENTS=true` in `.env.local` (or Vercel env), then restart `npm run dev` / redeploy. Badge reason: "Rehearsal mode" |
| **Auto: Stripe not configured** | `VITE_STRIPE_PUBLISHABLE_KEY` missing or still the `pk_test_...` placeholder: simulates without calling `pay`. If the key is fine but `pay` isn't deployed or has no `STRIPE_SECRET_KEY`, the lock call fails and the group switches to simulated |
| **Auto: Stripe call fails** | Any pay call that fails for infrastructure reasons (network, 5xx, Stripe API error, 401) switches the group to simulated and shows an amber notice with the error. Business-rule errors (400/404/409 such as "Group is cancelled") and card declines in the Stripe form are shown as before |

How it syncs: simulated state lives in `members.constraints.sim_payment` plus the usual `members.approved*` and `groups.status` columns, so every phone follows along over the existing Realtime subscriptions. A group counts as simulated once any member has a `sim_payment` for the locked plan, so every phone in that group uses the simulated path whatever its own env says. If Stripe fails in the middle of a real flow, approvals are kept, holds that were already authorized carry over as placed, and the real test-mode holds are never captured (Stripe releases uncaptured test authorizations on its own). Generating new plans clears the simulated holds, the same way it clears rejections.

## Demo script (2–3 min)

> Written for the old chat + payments flow; needs a rewrite for lobby → questionnaire → vote.

**0:00, the hook (Meta: human connection).** "Every group chat has this: 40 messages, no plan, and one friend quietly can't afford the idea everyone's excited about. Quorum turns the chat into a plan that works for *everyone*, and nobody has to front the money."

**0:20, chat → Grok (SpaceXAI).** The organizer creates "Saturday hang" and shares the code. Two teammates join on their phones with caps ($30, $60). In the live chat: *"Maya: vegetarian + broke, $30 max · Jon: I can drive, free after 1 · Priya: nothing over 25, no car."* Tap 🎙 for a voice note. Tap **Generate Plan**. Point out that Grok extracted Priya's $25 cap from slang, noticed two people have no car, and used only real catalog venues. Show the per-member budget check ("Maya $18 / $30 ✓").

**0:55, live approve/reject (Meta).** Everyone approves or rejects from their own phone, and tallies update in real time. On the flagged "splurge" plan, Maya taps **Reject → Too expensive**. Every phone shows "Maya rejected the plan. Reason: too expensive." The organizer taps **Regenerate within everyone's cap**, and every new plan fits every cap. The server double-checks Grok's math ("Checked by server").

**1:20, trusted payments (Visa: commerce + trust).** The organizer locks the winning plan. Each friend taps **Approve & hold my share** with Stripe's Visa test card 4242 4242 4242 4242. Every approval row, the split, and "Your plan" show the card as Visa •••• 4242. Explain that this is an **authorization hold, not a charge**. Show 2 uncaptured payments in the Stripe Dashboard. The last approval captures everything, and the screen shows **Booking confirmed 🎉**. Nobody Venmo-chases anyone.

**1:50, edge cases.** In a second group, lock an over-cap plan. Maya sees *"This plan is $42, above your $30 cap. Approve anyway?"*, and nothing is held until she says yes. Then **Cancel group**: every hold is released.

**2:15, the memory (SpaceXAI: Grok Imagine).** Tap **Make a recap card**. Close: "AI that plans *with* your friends, and money that moves only when everyone says yes."

Judging hooks. **Meta:** real-world connection, with AI synthesizing the group discussion. **Visa:** GenAI from discovery to decision to budget personalization to secure checkout, with manual capture as the consent layer. **SpaceXAI:** Grok structured outputs, Grok Imagine, voice (upgrade to Grok Voice), and built with Cursor. The frame is *financial inclusion in social life*.

**If Grok is down on stage:** Generate Plan falls back to saved plans for this exact conversation and shows a "saved demo plan" banner. **If Stripe is down or not set up:** Lock & collect falls back to simulated holds with a "Simulated payment (test)" badge (see "Simulated payments"). To rehearse without Stripe, set `VITE_SIMULATE_PAYMENTS=true`.

## Security notes (demo)

RLS is permissive so the demo works without login (see the header of `supabase/migrations/20260926000001_schema.sql`). The publishable key and Supabase URL are public by design. Never commit `sk_`, `xai-`, or service-role keys. Before real use: add Supabase Auth, tie members to `auth.uid()`, tighten policies, and add a Stripe webhook.

## Languages (i18n)

A globe switcher (`src/components/LanguageSwitcher.tsx`, top corner of every screen) translates the whole UI instantly:
English, Español, Français, Deutsch, Português, 中文, 한국어, हिन्दी, العربية (Arabic switches `<html dir="rtl">`).

- **Static UI strings** live in `src/i18n/en.json` (source of truth). `useT()` returns `t(key, vars)` with `{name}`
  placeholders and `_one`/`_other` plurals; `useLanguage()` gives `{ lang, setLang, dir }`. The choice is kept in
  localStorage (default: the browser language if supported, else English). Missing keys fall back to English.
- **Other languages** are generated by Grok and committed, so switching needs no network:
  `XAI_API_KEY=... node scripts/translate-i18n.mjs [es fr ...]` (model = make-plan's `DEFAULT_MODEL`, or `GROK_MODEL`).
  The script checks every key and `{placeholder}` survives. Re-run it after adding strings to `en.json`.
- **Dynamic Grok text** (plan titles, "why it fits", stop notes, transit tips) is translated on demand by the
  `translate-plan` Edge Function and cached in `plans.translations` (migration `20260927000002_plan_translations.sql`).
  English shows (with a shimmer) until the translation arrives. Venue names are never translated.
