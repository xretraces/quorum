// POST /functions/v1/make-plan  { group_id: string, transcript?: string, hard_cap?: boolean }
// Calls Grok (xAI chat completions, strict JSON schema) to extract each member's constraints and
// propose 2-3 plans from the fixed Atlanta catalog, re-validates everything server-side, then
// replaces the group's plans rows. Secrets: GROK_API_KEY (or XAI_API_KEY), optional GROK_MODEL.

import { CATALOG_FILE } from "../_shared/catalog.ts";
import { PLAN_SCHEMA } from "../_shared/plan-schema.ts";
import { SYSTEM_PROMPT } from "../_shared/system-prompt.ts";
import { adminClient, type GroupRow, type MemberRow } from "../_shared/db.ts";
import { HttpError, optString, reqString, serveJson } from "../_shared/http.ts";
import {
  type CatalogItem,
  type ModelOutput,
  normalizeModelOutput,
  schemaForRequest,
  validateSchema,
} from "../_shared/logic.ts";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-4.7"; // override with the GROK_MODEL secret
const catalog = CATALOG_FILE.activities as unknown as CatalogItem[];
const requestSchema = schemaForRequest(PLAN_SCHEMA, catalog.map((c) => c.id));

async function callGrok(userPayload: unknown, model: string, apiKey: string): Promise<{ output: ModelOutput; raw: string }> {
  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages: { role: string; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
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
        response_format: {
          type: "json_schema",
          json_schema: { name: "plan_and_pay", schema: requestSchema, strict: true },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new HttpError(502, `xAI API error ${res.status}`, text.slice(0, 2000));
    }
    const data = await res.json();
    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new HttpError(502, "xAI response had no message content", data);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      lastErrors = ["content was not valid JSON"];
      continue;
    }
    lastErrors = validateSchema(requestSchema, parsed);
    if (lastErrors.length === 0) return { output: parsed as ModelOutput, raw: content };
  }
  throw new HttpError(502, "Grok output failed validation after retry", lastErrors);
}

Deno.serve(serveJson(async (body) => {
  const groupId = reqString(body, "group_id");
  const transcriptIn = optString(body, "transcript");
  // Set after someone rejects a plan as too expensive: every returned plan must fit every known cap.
  const hardCap = body.hard_cap === true;

  const apiKey = Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY");
  if (!apiKey) throw new HttpError(500, "GROK_API_KEY (or XAI_API_KEY) secret is not set");
  const model = Deno.env.get("GROK_MODEL") || DEFAULT_MODEL;

  const db = adminClient();
  const { data: group, error: gErr } = await db.from("groups").select("*").eq("id", groupId).maybeSingle<GroupRow>();
  if (gErr) throw gErr;
  if (!group) throw new HttpError(404, "Group not found");
  if (group.status === "captured" || group.status === "partially_captured") {
    throw new HttpError(409, "This group has already paid; start a new group.");
  }

  // Don't swap plans out from under live card holds.
  const { data: live, error: pErr } = await db.from("payments").select("id,status").eq("group_id", groupId);
  if (pErr) throw pErr;
  if ((live ?? []).some((p) => p.status !== "canceled")) {
    throw new HttpError(409, "Cancel the existing holds (pay: cancel) before generating new plans.");
  }

  const { data: members, error: mErr } = await db.from("members").select("*").eq("group_id", groupId).order("created_at");
  if (mErr) throw mErr;
  const roster = (members ?? []) as MemberRow[];

  const transcript = transcriptIn ?? group.transcript ?? "";
  if (!transcript && roster.length === 0) throw new HttpError(400, "Provide a transcript or add members first.");

  const userPayload = {
    roster: roster.map((m) => ({
      member_id: m.id,
      name: m.display_name,
      confirmed_budget_cap_cents: m.cap_source === "member" ? m.budget_cap_cents : null,
      dietary: m.dietary ?? "",
      availability: m.availability ?? "",
      location: m.location ?? "",
      transport: m.transport ?? "",
    })),
    catalog: catalog.map(({ id, name, category, neighborhood, price_per_person_cents, veg_friendly, transit_friendly, typical_hours, duration_minutes, transit_note, dietary_note }) => ({
      id, name, category, neighborhood, price_per_person_cents, veg_friendly, transit_friendly, typical_hours, duration_minutes, transit_note, dietary_note,
    })),
    transcript: transcript.slice(0, 20_000),
    ...(hardCap
      ? { hard_budget_rule: "A member rejected the last plans as too expensive. Every plan MUST have per_person_cents <= every known budget cap. Do not propose any flagged over-cap plan; prefer free and cheap catalog items." }
      : {}),
  };

  const { output } = await callGrok(userPayload, model, apiKey);
  const rosterForLogic = roster.map((m) => ({
    id: m.id,
    display_name: m.display_name,
    budget_cap_cents: m.cap_source === "member" ? m.budget_cap_cents : null, // re-extract grok caps each run
    dietary: m.dietary,
    transport: m.transport,
  }));
  const normalized = normalizeModelOutput(output, catalog, rosterForLogic);
  const { memberUpdates, warnings } = normalized;
  const plans = hardCap
    ? normalized.plans.filter((p) => p.over_cap_member_ids.length === 0).map((p, i) => ({ ...p, option_index: i }))
    : normalized.plans;
  if (hardCap && plans.length < normalized.plans.length) warnings.push("Dropped plans that exceed a member's cap (hard_cap).");
  if (plans.length === 0) throw new HttpError(502, "Grok returned no usable plans", warnings);

  // Replace plans. (Not transactional; fine for a demo. Wrap it in an RPC for real use.)
  const del1 = await db.from("payments").delete().eq("group_id", groupId).eq("status", "canceled");
  if (del1.error) throw del1.error;
  const reset = await db.from("members")
    .update({ vote_plan_id: null, approved: false, approved_amount_cents: null, approved_at: null })
    .eq("group_id", groupId);
  if (reset.error) throw reset.error;
  const del2 = await db.from("plans").delete().eq("group_id", groupId);
  if (del2.error) throw del2.error;

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
      over_cap_member_ids: p.over_cap_member_ids,
      member_notes: p.member_notes,
      why_it_works: p.why_it_works,
      reasoning: output.reasoning,
      server_warnings: p.server_warnings,
      model,
      raw: output,
    })),
  ).select("*");
  if (iErr) throw iErr;

  for (const u of memberUpdates) {
    const patch: Record<string, unknown> = {
      constraints: u.constraints,
      dietary: u.dietary,
      availability: u.availability,
      location: u.location,
      transport: u.transport,
    };
    if (u.budget_cap_cents !== undefined) {
      patch.budget_cap_cents = u.budget_cap_cents;
      patch.cap_source = "grok";
    }
    const r = await db.from("members").update(patch).eq("id", u.id);
    if (r.error) throw r.error;
  }

  const g = await db.from("groups")
    .update({ status: "voting", transcript: transcript || null, selected_plan_id: null })
    .eq("id", groupId);
  if (g.error) throw g.error;

  return { plans: inserted, extracted_members: output.members, constraints: output.constraints, reasoning: output.reasoning, warnings, model };
}));
