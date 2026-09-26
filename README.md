# Quorum

**Turn group-chat chaos into a plan everyone can afford.** Friends create or join a group from their phones, set a personal spending limit, and chat. One tap sends the chat to **Grok**, which extracts each person's budget, diet, availability, and transport and proposes 2–3 real Atlanta plans with an *estimated* per-person cost and a note on why each plan fits each person. The server (not the AI) re-checks every price and budget. Everyone approves or rejects live. If someone rejects a plan as "too expensive", Grok regenerates with everyone's cap as a hard limit. When the organizer locks a plan, each person places a **Stripe test-mode card hold** (manual capture), and money is captured only when **every** member has approved. Anyone over their cap must explicitly approve the higher amount. Built at HackGT 13.

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
  lib/fallback.ts        saved demo plans, used only if the make-plan call fails
supabase/
  functions/             make-plan, pay, recap-image + _shared (logic, tests, generated catalog/schema/prompt)
  migrations/            20260926000001_schema.sql (kit schema.sql), 20260926000002_messages.sql (group chat)
  config.toml            verify_jwt = false for the three functions
data/                    atlanta-activities.json (catalog; prices are approximate demo data)
prompts/                 make-plan.md (Grok system prompt, between PROMPT markers)
schema/                  plan.schema.json (strict Grok output schema)
scripts/sync-shared.sh   regenerate supabase/functions/_shared/*.ts after editing data/, schema/, prompts/
tools/prompt-tests/      run.py: live-test the Grok prompt against sample chats (Python stdlib only)
docs/TEAM_SPEC.md        original product spec (screens/flow/UX; ignore its Express/Firebase backend)
```

## Database

Project ref **`oavxpwpdhdazhtieikju`**. Both migrations are **already applied** to the live database; the files are here for reference and for fresh projects. Don't re-run them against the shared DB (they are idempotent, but there's no need).

- `groups`, `members`, `plans`, `payments`: kit schema, permissive demo RLS, Realtime on. `payments` is read-only for clients.
- `messages`: live group chat (`sender_name`, `text`, `created_at`), Realtime on.
- Rejections are stored in `members.constraints.rejection = { plan_id, reason, at }`, so no schema change was needed. `make-plan` overwrites `constraints`, which clears the rejection.

## How the flow maps to the code

| Step (TEAM_SPEC) | Where |
| --- | --- |
| Create / join group, name + spending limit (validated) | `CreateGroup.tsx`, `JoinGroup.tsx` |
| Live group chat | `GroupChat.tsx` (`messages` + Realtime) |
| Generate Plan → Grok | `GroupBoard.generate()` → `make-plan` with the chat transcript |
| Plan cards, estimated cost, per-member budget check | `PlanCard.tsx` (budget math in code: `overCapBy`) |
| Approve / reject live | Approve = `members.vote_plan_id`; Reject = `RejectButton.tsx`; everyone refetches on Realtime |
| Rejected "too expensive" → regenerate with hard caps | `GroupBoard` banner → `make-plan` with `hard_cap: true` (server drops over-cap plans) |
| Over-budget user must approve explicitly | `pay` returns `needs_reapproval` → `PayButton` "Approve anyway" |
| Book & split (test-mode holds), confirmation | Organizer "Lock & collect" → `pay hold`; `PayButton` per member; `pay approve` captures all when everyone is in; `LockedPlan.tsx` |
| Grok failure | `lib/fallback.ts`: saved plans (recomputed against the real roster) + a visible "demo plan" banner |

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
# No Docker? add --use-api
```

`pay` refuses non-test Stripe keys. `SUPABASE_URL` and the service keys are injected automatically; don't set anything that starts with `SUPABASE_`. `--no-verify-jwt` is needed because `sb_publishable_` keys aren't JWTs (also set in `supabase/config.toml`); the functions check for the project's publishable key instead. That check is not auth, which is fine for a demo.

Local function checks (Deno 2):

```bash
export DENO_NO_PACKAGE_JSON=1   # keep Deno from reading the web app's package.json
deno check --node-modules-dir=none supabase/functions/*/index.ts
deno lint supabase/functions
deno test --node-modules-dir=none supabase/functions/_shared/logic.test.ts
```

## Deploy web (Vercel)

Import the repo → framework **Vite** → add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY` → Deploy. `vercel.json` rewrites everything to `index.html`, so `/join/<code>` and `/g/<id>` deep links work.

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

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Hold succeeds (`requires_capture`) |
| `4000 0027 6000 3184` | 3-D Secure challenge |
| `4000 0000 0000 9995` | Declined (insufficient funds) |

Any future expiry, any CVC, any ZIP. Holds show as **Uncaptured** in Stripe Dashboard (test mode) → Payments.

## Demo script (2–3 min)

**0:00, the hook (Meta: human connection).** "Every group chat has this: 40 messages, no plan, and one friend quietly can't afford the idea everyone's excited about. Quorum turns the chat into a plan that works for *everyone*, and nobody has to front the money."

**0:20, chat → Grok (SpaceXAI).** The organizer creates "Saturday hang" and shares the code. Two teammates join on their phones with caps ($30, $60). In the live chat: *"Maya: vegetarian + broke, $30 max · Jon: I can drive, free after 1 · Priya: nothing over 25, no car."* Tap 🎙 for a voice note. Tap **Generate Plan**. Point out that Grok extracted Priya's $25 cap from slang, noticed two people have no car, and used only real catalog venues. Show the per-member budget check ("Maya $18 / $30 ✓").

**0:55, live approve/reject (Meta).** Everyone approves or rejects from their own phone, and tallies update in real time. On the flagged "splurge" plan, Maya taps **Reject → Too expensive**. Every phone shows "Maya rejected the plan. Reason: too expensive." The organizer taps **Regenerate within everyone's cap**, and every new plan fits every cap. The server double-checks Grok's math ("Checked by server").

**1:20, trusted payments (Visa: commerce + trust).** The organizer locks the winning plan. Each friend taps **Approve & hold my share** with card 4242. Explain that this is an **authorization hold, not a charge**. Show 2 uncaptured payments in the Stripe Dashboard. The last approval captures everything, and the screen shows **Booking confirmed 🎉**. Nobody Venmo-chases anyone.

**1:50, edge cases.** In a second group, lock an over-cap plan. Maya sees *"This plan is $42, above your $30 cap. Approve anyway?"*, and nothing is held until she says yes. Then **Cancel group**: every hold is released.

**2:15, the memory (SpaceXAI: Grok Imagine).** Tap **Make a recap card**. Close: "AI that plans *with* your friends, and money that moves only when everyone says yes."

Judging hooks. **Meta:** real-world connection, with AI synthesizing the group discussion. **Visa:** GenAI from discovery to decision to budget personalization to secure checkout, with manual capture as the consent layer. **SpaceXAI:** Grok structured outputs, Grok Imagine, voice (upgrade to Grok Voice), and built with Cursor. The frame is *financial inclusion in social life*.

**If Grok is down on stage:** Generate Plan falls back to saved plans for this exact conversation and shows a "saved demo plan" banner. Payments still need the deployed `pay` function and a Stripe test key.

## Security notes (demo)

RLS is permissive so the demo works without login (see the header of `supabase/migrations/20260926000001_schema.sql`). The publishable key and Supabase URL are public by design. Never commit `sk_`, `xai-`, or service-role keys. Before real use: add Supabase Auth, tie members to `auth.uid()`, tighten policies, and add a Stripe webhook.
