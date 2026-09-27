// POST /functions/v1/translate-plan  { plan_id: string, lang: "es" | "fr" | "de" | "pt" | "zh" | "ko" | "hi" | "ar" }
// Translates a plan's text (title, summary, "why it fits", each stop's note, and the catalog transit tip per stop)
// with Grok (xAI chat completions, strict JSON schema, same model as make-plan). Venue names are never sent as
// text to translate, and the prompt keeps proper nouns and prices as they are.
// Cache: plans.translations[lang] (migration 20260927000002_plan_translations.sql), written through the
// set_plan_translation() RPC so concurrent languages don't clobber each other. Until that migration is applied,
// the function still works and just returns uncached translations.
// Secrets: GROK_API_KEY (or XAI_API_KEY), optional GROK_MODEL.

import { CATALOG_FILE } from "../_shared/catalog.ts";
import { adminClient } from "../_shared/db.ts";
import { HttpError, reqString, serveJson } from "../_shared/http.ts";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-4.7"; // override with the GROK_MODEL secret (same default as make-plan)

const LANGUAGES: Record<string, string> = {
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese (Brazil)",
  zh: "Simplified Chinese",
  ko: "Korean",
  hi: "Hindi",
  ar: "Arabic",
};

type CatalogEntry = { id: string; transit_note?: string };
const TRANSIT = new Map((CATALOG_FILE.activities as unknown as CatalogEntry[]).map((c) => [c.id, c.transit_note ?? ""]));

type PlanItem = { catalog_id: string; name: string; note?: string | null };
type PlanText = { title: string; summary: string; why_it_works: string; items: { note: string; transit_note: string }[] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "why_it_works", "items"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    why_it_works: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["note", "transit_note"],
        properties: { note: { type: "string" }, transit_note: { type: "string" } },
      },
    },
  },
};

const prompt = (language: string, venues: string[]) =>
  [
    `You translate short UI text for Quorum, a group-planning app in Atlanta, from English into ${language}.`,
    "Return JSON with exactly the same shape and the same number of items. Translate every string value.",
    "Keep an empty string empty. Keep it casual, short and natural for a phone screen.",
    "Do NOT translate proper nouns: venue and place names, neighborhoods, streets, MARTA line/station names, brand names (Quorum, Grok).",
    `Venue names that must stay exactly as written: ${venues.map((v) => JSON.stringify(v)).join(", ") || "(none)"}.`,
    "Keep prices, numbers, times and emoji exactly as they are.",
  ].join("\n");

async function translate(source: PlanText, lang: string, venues: string[], apiKey: string, model: string): Promise<PlanText> {
  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt(LANGUAGES[lang], venues) },
        { role: "user", content: JSON.stringify(source) },
      ],
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: { name: "quorum_plan_translation", schema: SCHEMA, strict: true } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`xAI API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("xAI response had no message content");
  const out = JSON.parse(content) as PlanText;
  if (typeof out.title !== "string" || !Array.isArray(out.items) || out.items.length !== source.items.length) {
    throw new Error("Grok translation did not match the plan's shape");
  }
  // Never let a blank translation replace real text, and keep blanks blank.
  const pick = (tr: unknown, en: string) => (en === "" ? "" : typeof tr === "string" && tr.trim() ? tr.trim() : en);
  return {
    title: pick(out.title, source.title),
    summary: pick(out.summary, source.summary),
    why_it_works: pick(out.why_it_works, source.why_it_works),
    items: source.items.map((it, i) => ({
      note: pick(out.items[i]?.note, it.note),
      transit_note: pick(out.items[i]?.transit_note, it.transit_note),
    })),
  };
}

Deno.serve(serveJson(async (body) => {
  const planId = reqString(body, "plan_id");
  const lang = reqString(body, "lang");
  if (!(lang in LANGUAGES)) throw new HttpError(400, `Unsupported language "${lang}"`, { supported: Object.keys(LANGUAGES) });

  const db = adminClient();
  let cacheable = true;
  let res = await db.from("plans").select("id,title,summary,why_it_works,items,translations").eq("id", planId).maybeSingle();
  if (res.error?.code === "42703") { // plans.translations doesn't exist yet: migration not applied
    cacheable = false;
    res = await db.from("plans").select("id,title,summary,why_it_works,items").eq("id", planId).maybeSingle();
  }
  if (res.error) throw res.error;
  const plan = res.data as { title: string; summary: string | null; why_it_works: string | null; items: PlanItem[]; translations?: Record<string, PlanText> | null } | null;
  if (!plan) throw new HttpError(404, "Plan not found");

  const cached = plan.translations?.[lang];
  if (cached) return { translation: cached, cached: true };

  const apiKey = Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY");
  if (!apiKey) throw new HttpError(503, "Translation is not configured (GROK_API_KEY missing).");
  const model = Deno.env.get("GROK_MODEL") || DEFAULT_MODEL;

  const items = Array.isArray(plan.items) ? plan.items : [];
  const source: PlanText = {
    title: plan.title ?? "",
    summary: plan.summary ?? "",
    why_it_works: plan.why_it_works ?? "",
    items: items.map((it) => ({ note: it.note ?? "", transit_note: TRANSIT.get(it.catalog_id) ?? "" })),
  };
  const translation = await translate(source, lang, items.map((it) => it.name), apiKey, model);

  let stored = false;
  if (cacheable) {
    const { error } = await db.rpc("set_plan_translation", { p_plan_id: planId, p_lang: lang, p_translation: translation });
    if (error) console.warn("translate-plan: caching failed, returning uncached:", error.message);
    else stored = true;
  }
  return { translation, cached: false, stored };
}));
