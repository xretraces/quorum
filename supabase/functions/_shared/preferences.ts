// Questionnaire preferences parsed from a spoken transcript (parse-prefs). Pure code, no Deno APIs, so the
// web app can import the type too.

export type Transport = "car" | "marta" | "rideshare" | "walk";

export type Preferences = {
  budget: number | null; // max $ per person
  food: string; // diet, allergies, cravings
  transport: Transport | null;
  freeFrom: string | null; // 24h "HH:MM"
  freeUntil: string | null; // 24h "HH:MM"
  hardNos: string; // things they won't do
  other: string;
};

export const TRANSPORTS: readonly Transport[] = ["car", "marta", "rideshare", "walk"];
export const MAX_TRANSCRIPT_CHARS = 2000;
const MAX_BUDGET = 1000;
const MAX_TEXT = 500;

/**
 * Grok structured output. Strict mode wants every key required, so "not mentioned" is null and the
 * server drops nulls afterwards.
 */
export const PREFS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["budget", "food", "transport", "freeFrom", "freeUntil", "hardNos", "other", "heard"],
  properties: {
    budget: { type: ["number", "null"], description: "Max dollars per person, e.g. 'about 35 bucks' -> 35, 'under 50' -> 50." },
    food: { type: ["string", "null"], description: "Diet, allergies, cravings." },
    transport: { type: ["string", "null"], enum: [...TRANSPORTS, null] },
    freeFrom: { type: ["string", "null"], description: "24h HH:MM, e.g. 'after 6' -> '18:00'." },
    freeUntil: { type: ["string", "null"], description: "24h HH:MM." },
    hardNos: { type: ["string", "null"], description: "Things they won't do, e.g. 'no bars', 'nothing with heights'." },
    other: { type: ["string", "null"], description: "Anything else relevant to planning an outing." },
    heard: { type: "string", description: "One short sentence restating what was understood." },
  },
} as const;

export const PREFS_SYSTEM_PROMPT = `You turn one person's spoken answer into questionnaire fields for planning a group outing in Atlanta.
Return JSON matching the schema. Use null for every field the person did not mention. Never guess.
- budget: max dollars per person as a number ("about 35 bucks" -> 35, "under 50" -> 50).
- transport: "train", "MARTA" or "bus" -> "marta"; "Uber" or "Lyft" -> "rideshare"; driving -> "car"; walking -> "walk".
- freeFrom / freeUntil: 24h "HH:MM". Evening outings: "after 6" -> "18:00", "until 11" -> "23:00".
- food: diet, allergies, cravings. hardNos: things they won't do. other: anything else relevant.
- If "current" answers are given and the person changes or adds to a text field, return the full updated text for that field.
- heard: one short, friendly sentence restating what you understood.`;

const TRANSPORT_WORDS: [RegExp, Transport][] = [
  [/\b(train|marta|bus)\b/i, "marta"],
  [/\b(uber|lyft|rideshare|ride share)\b/i, "rideshare"],
  [/\b(drive|driving|car)\b/i, "car"],
  [/\b(walk|walking)\b/i, "walk"],
];

/** "18:00", "6:30", "18" -> "HH:MM"; anything else -> null. */
export function normalizeTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function cleanText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, MAX_TEXT);
  return s === "" ? undefined : s;
}

/**
 * Keeps only known keys with usable values: budget clamped to 0-1000, transport coerced to the enum,
 * times as HH:MM, empty/null values dropped (they mean "not mentioned").
 */
export function normalizePrefs(raw: unknown): Partial<Preferences> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Preferences> = {};

  const budget = typeof r.budget === "string" ? Number(r.budget.replace(/[$,\s]/g, "")) : r.budget;
  if (typeof budget === "number" && Number.isFinite(budget)) {
    out.budget = Math.round(Math.min(MAX_BUDGET, Math.max(0, budget)));
  }
  const transport = typeof r.transport === "string" ? r.transport.trim().toLowerCase() : "";
  if ((TRANSPORTS as readonly string[]).includes(transport)) out.transport = transport as Transport;
  else if (transport) {
    const hit = TRANSPORT_WORDS.find(([re]) => re.test(transport)); // "Uber" -> rideshare, "bus" -> marta
    if (hit) out.transport = hit[1];
  }
  const freeFrom = normalizeTime(r.freeFrom);
  if (freeFrom) out.freeFrom = freeFrom;
  const freeUntil = normalizeTime(r.freeUntil);
  if (freeUntil) out.freeUntil = freeUntil;
  for (const k of ["food", "hardNos", "other"] as const) {
    const s = cleanText(r[k]);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

const DIET_WORDS = [
  "vegetarian", "vegan", "pescatarian", "gluten[- ]free", "dairy[- ]free", "lactose intolerant", "halal", "kosher",
  "nut allergy", "peanut allergy", "shellfish allergy",
];

/** Cheap no-LLM parse used when Grok is unavailable. The whole transcript goes into `other`. */
export function fallbackParse(transcript: string): Partial<Preferences> {
  const out: Partial<Preferences> = {};
  const money = transcript.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars|bucks)\b/i);
  if (money) out.budget = Math.round(Math.min(MAX_BUDGET, Number(money[1] ?? money[2])));

  let first = Infinity;
  for (const [re, mode] of TRANSPORT_WORDS) {
    const i = transcript.search(re);
    if (i >= 0 && i < first) {
      first = i;
      out.transport = mode;
    }
  }
  const diets = DIET_WORDS.flatMap((w) => transcript.match(new RegExp(`\\b${w}\\b`, "i"))?.[0].toLowerCase() ?? []);
  if (diets.length) out.food = diets.join(", ");
  const other = cleanText(transcript);
  if (other) out.other = other;
  return out;
}

/** Plain-English restatement for the fallback path. */
export function describePrefs(p: Partial<Preferences>): string {
  const parts: string[] = [];
  if (p.budget !== undefined && p.budget !== null) parts.push(`up to $${p.budget} per person`);
  if (p.food) parts.push(`food: ${p.food}`);
  if (p.transport) parts.push(`getting there by ${p.transport === "marta" ? "MARTA" : p.transport}`);
  if (p.freeFrom || p.freeUntil) parts.push(`free ${p.freeFrom ? `from ${p.freeFrom}` : ""}${p.freeFrom && p.freeUntil ? " " : ""}${p.freeUntil ? `until ${p.freeUntil}` : ""}`);
  if (p.hardNos) parts.push(`no: ${p.hardNos}`);
  return parts.length ? `Heard: ${parts.join("; ")}.` : "Got it. I saved what you said as a note.";
}
