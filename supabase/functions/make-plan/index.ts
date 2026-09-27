// POST /functions/v1/make-plan  { group_id: string }
// Builds 2-3 plans from the members' PRIVATE questionnaire answers (member_prefs, read with the service role),
// not from chat. Grok (xAI chat completions, strict JSON schema, reasoning_effort "low") sees the answers
// anonymized; the server re-checks every plan against the hard rules (budget cap, hard no's, transport, free
// window, opening hours) and drops failures. If Grok is unavailable or nothing it proposed survives, deterministic backup
// plans are built from the same answers (model "backup"). Replaces the group's plans and resets votes.
// Grok gets at most GROK_BUDGET_MS in total (first attempt capped at GROK_FIRST_ATTEMPT_MS, the validation retry
// only gets what is left), so a slow Grok falls back to backup plans at ~110s instead of hitting the Edge
// Function wall-clock limit. The response carries `notice` when the backup plans had to ignore the free-time window.
// Nothing written or returned names a member or reveals one person's answers.
// Secrets: GROK_API_KEY (or XAI_API_KEY), optional GROK_MODEL.

import { CATALOG_FILE } from "../_shared/catalog.ts";
import { adminClient } from "../_shared/db.ts";
import { HttpError, reqString, serveJson } from "../_shared/http.ts";
import { schemaForRequest, validateSchema } from "../_shared/logic.ts";
import {
  backupPlans,
  type CatalogEntry,
  type GrokPlan,
  grokPayload,
  groupNeeds,
  type GroupNeeds,
  normalizeGrokPlans,
  PREFS_PLAN_PROMPT,
  PREFS_PLAN_SCHEMA,
  type PlanRow,
  readPrefs,
} from "../_shared/prefsPlan.ts";
import type { Preferences } from "../_shared/preferences.ts";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-4.7"; // override with the GROK_MODEL secret
const GROK_FIRST_ATTEMPT_MS = 75_000;
const GROK_BUDGET_MS = 110_000; // total across both attempts; leaves room under the 150s wall-clock limit
const GROK_MIN_RETRY_MS = 5_000; // skip the retry if less than this is left
const catalog = CATALOG_FILE.activities as unknown as CatalogEntry[];
const requestSchema = schemaForRequest(PREFS_PLAN_SCHEMA as unknown as Record<string, unknown>, catalog.map((c) => c.id));

async function callGrok(userPayload: unknown, model: string, apiKey: string): Promise<GrokPlan[]> {
  let lastErrors: string[] = [];
  const started = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const left = GROK_BUDGET_MS - (Date.now() - started);
    if (attempt > 1 && left < GROK_MIN_RETRY_MS) break; // out of time: backup plans instead of a retry
    const timeoutMs = attempt === 1 ? GROK_FIRST_ATTEMPT_MS : left;
    const messages: { role: string; content: string }[] = [
      { role: "system", content: PREFS_PLAN_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) },
    ];
    if (attempt > 1) {
      messages.push({
        role: "user",
        content: `Your previous output failed validation: ${lastErrors.slice(0, 10).join("; ")}. Return corrected JSON only.`,
      });
    }
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        reasoning_effort: "low",
        response_format: {
          type: "json_schema",
          json_schema: { name: "quorum_plans", schema: requestSchema, strict: true },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`xAI API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = await res.json();
    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("xAI response had no message content");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      lastErrors = ["content was not valid JSON"];
      continue;
    }
    lastErrors = validateSchema(requestSchema, parsed);
    if (lastErrors.length === 0) return (parsed as { plans: GrokPlan[] }).plans;
  }
  throw new Error(`Grok output failed validation (no time left or after retry): ${lastErrors.slice(0, 5).join("; ")}`);
}

async function planWithGrok(all: Preferences[], needs: GroupNeeds, names: string[]) {
  const apiKey = Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY");
  if (!apiKey) {
    console.warn("make-plan: GROK_API_KEY not set, using backup plans");
    return null;
  }
  const model = Deno.env.get("GROK_MODEL") || DEFAULT_MODEL;
  try {
    const raw = await callGrok(grokPayload(all, needs, catalog), model, apiKey);
    const { plans, dropped } = normalizeGrokPlans(raw, catalog, needs, names);
    if (dropped.length) console.warn("make-plan: dropped Grok plans:", dropped); // server log only
    if (plans.length === 0) {
      console.warn("make-plan: no Grok plan passed the hard rules, using backup plans");
      return null;
    }
    return { plans, model };
  } catch (err) {
    console.error("make-plan: Grok failed, using backup plans:", err instanceof Error ? err.message : err);
    return null;
  }
}

Deno.serve(serveJson(async (body) => {
  const groupId = reqString(body, "group_id");

  const db = adminClient();
  const { data: group, error: gErr } = await db.from("groups").select("id,status").eq("id", groupId).maybeSingle();
  if (gErr) throw gErr;
  if (!group) throw new HttpError(404, "Group not found");
  if (group.status === "decided") throw new HttpError(409, "This group already picked a plan.");

  const { data: members, error: mErr } = await db.from("members")
    .select("id,display_name,prefs_ready").eq("group_id", groupId).order("created_at");
  if (mErr) throw mErr;
  const roster = (members ?? []) as { id: string; display_name: string; prefs_ready: boolean }[];

  const { data: rows, error: pErr } = await db.from("member_prefs").select("member_id,prefs").eq("group_id", groupId);
  if (pErr) throw pErr;
  const answered = new Map((rows ?? []).filter((r) => r.prefs).map((r) => [r.member_id as string, r.prefs as unknown]));
  const all = roster.filter((m) => answered.has(m.id)).map((m) => readPrefs(answered.get(m.id)));
  const needed = Math.min(2, roster.length);
  if (all.length < Math.max(1, needed)) throw new HttpError(400, "Wait until at least 2 people have answered.");

  const needs = groupNeeds(all, roster.length);
  const names = roster.map((m) => m.display_name);
  const fromGrok = await planWithGrok(all, needs, names);
  const backup = fromGrok ? null : backupPlans(catalog, needs);
  const plans: PlanRow[] = fromGrok?.plans ?? backup!.plans;
  const notice = backup?.notice ?? null;
  const model = fromGrok?.model ?? "backup";
  if (plans.length === 0) {
    throw new HttpError(422, "Nothing in the catalog fits everyone's answers. Try loosening a budget or a hard no.");
  }

  // Replace plans. (Not transactional; fine for a demo.)
  const reset = await db.from("members").update({ vote_plan_id: null }).eq("group_id", groupId);
  if (reset.error) throw reset.error;
  const g0 = await db.from("groups").update({ selected_plan_id: null, recap_image_url: null }).eq("id", groupId);
  if (g0.error) throw g0.error;
  const del = await db.from("plans").delete().eq("group_id", groupId);
  if (del.error) throw del.error;

  const { data: inserted, error: iErr } = await db.from("plans").insert(
    plans.map((p) => ({
      group_id: groupId,
      option_index: p.option_index,
      title: p.title,
      summary: p.summary,
      items: p.items,
      per_person_cents: p.per_person_cents,
      total_cents: p.total_cents,
      fits_everyone: p.fits_everyone,
      over_cap_member_ids: [],
      member_notes: [],
      why_it_works: p.why_it_works,
      reasoning: null,
      server_warnings: [],
      model,
      raw: null,
    })),
  ).select("*");
  if (iErr) throw iErr;

  const g = await db.from("groups").update({ status: "voting" }).eq("id", groupId);
  if (g.error) throw g.error;

  return { plans: inserted, model, source: fromGrok ? "grok" : "backup", answered: all.length, notice };
}));
