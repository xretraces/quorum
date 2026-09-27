// Questionnaire preferences parsed from a spoken transcript (parse-prefs). Pure code, no Deno APIs, so the
// web app can import the type too. The form is four fields: budget, dietary, availability, other.
import { parseBudget } from "./budget.ts";

export type Preferences = {
  budget: number | null; // max $ per person
  dietary: string; // diet, allergies, cravings
  availability: string; // when they're free, free text
  other: string;
};

export const MAX_TRANSCRIPT_CHARS = 2000;
const MAX_BUDGET = 1000;
const MAX_TEXT = 1500; // keep in sync with the Other textarea maxLength (Questionnaire.tsx)

/**
 * Grok structured output. Strict mode wants every key required, so "not mentioned" is null and the
 * server drops nulls afterwards.
 */
export const PREFS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["budget", "dietary", "availability", "other", "heard"],
  properties: {
    budget: { type: ["number", "null"], description: "Max dollars per person, e.g. 'about 35 bucks' -> 35, 'under 50' -> 50." },
    dietary: { type: ["string", "null"], description: "Diet, allergies, cravings. e.g. vegetarian, no peanuts." },
    availability: { type: ["string", "null"], description: "When they are free, in their words. e.g. 'Saturday after 2pm'." },
    other: { type: ["string", "null"], description: "Anything else relevant to planning an outing." },
    heard: { type: "string", description: "One short sentence restating what was understood." },
  },
} as const;

export const PREFS_SYSTEM_PROMPT = `You turn one person's spoken answer into questionnaire fields for planning a group outing in Atlanta.
Return JSON matching the schema. Use null for every field the person did not mention. Never guess.
- budget: max dollars per person as a number ("about 35 bucks" -> 35, "under 50" -> 50).
- dietary: diet, allergies, cravings ("vegetarian, no peanuts").
- availability: when they are free, in their words ("Saturday after 2pm", "free until 11").
- other: anything else relevant (getting around, hard no's, vibes).
- If "current" answers are given and the person changes or adds to a text field, return the full updated text for that field.
- heard: one short, friendly sentence restating what you understood.`;

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

/** Older saves used food + freeFrom/freeUntil. Fold those into the four current fields (hardNos/transport below). */
function legacyAvailability(r: Record<string, unknown>): string | undefined {
  const from = normalizeTime(r.freeFrom);
  const until = normalizeTime(r.freeUntil);
  if (from && until) return `${from}–${until}`;
  if (from) return `from ${from}`;
  if (until) return `until ${until}`;
  return undefined;
}

const LEGACY_TRANSPORT: Record<string, string> = {
  marta: "I take MARTA, no car",
  walk: "walking, no car",
  car: "I can drive",
  rideshare: "getting there by rideshare",
};

/**
 * Older saves also had hardNos and transport. Fold them into "other" in words the plan rules read:
 * hardNos "heights, museums" -> "no heights, no museums"; transport "marta" -> "I take MARTA, no car".
 */
function legacyOther(r: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  const hardNos = cleanText(r.hardNos);
  if (hardNos) {
    parts.push(hardNos.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)
      .map((x) => (/^(?:no|not|nothing|never|don'?t|won'?t|can'?t|avoid|hate|without)\b/i.test(x) ? x : `no ${x}`))
      .join(", "));
  }
  const transport = cleanText(r.transport)?.toLowerCase();
  if (transport) parts.push(LEGACY_TRANSPORT[transport] ?? `getting there by ${transport}`);
  return parts.length ? parts.join(". ") : undefined;
}

/**
 * Keeps only known keys with usable values: budget clamped to 0-1000, text trimmed,
 * empty/null values dropped (they mean "not mentioned").
 */
export function normalizePrefs(raw: unknown): Partial<Preferences> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Preferences> = {};

  // Text like "under $25" or "$20-30" counts too, so a budget saved as words is never silently dropped.
  const budget = parseBudget(r.budget);
  if (budget !== null) out.budget = budget;
  const dietary = cleanText(r.dietary) ?? cleanText(r.food);
  if (dietary) out.dietary = dietary;
  const availability = cleanText(r.availability) ?? legacyAvailability(r);
  if (availability) out.availability = availability;
  const other = [cleanText(r.other), legacyOther(r)].filter(Boolean).join(". ").slice(0, MAX_TEXT);
  if (other) out.other = other;
  return out;
}

const DIET_WORDS = [
  "vegetarian", "vegan", "pescatarian", "gluten[- ]free", "dairy[- ]free", "lactose intolerant", "halal", "kosher",
  "nut allergy", "peanut allergy", "shellfish allergy",
];

const AVAIL_WORDS = /\b(?:free|available|after|until|before|tonight|tomorrow|this weekend|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b[^.]{0,60}/i;

/** Cheap no-LLM parse used when Grok is unavailable. The whole transcript goes into `other`. */
export function fallbackParse(transcript: string): Partial<Preferences> {
  const out: Partial<Preferences> = {};
  const money = transcript.match(
    /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars|bucks)\b|\b(?:under|below|less than|max(?:imum)?|up to|at most|no more than)\s+(\d+(?:\.\d+)?)\b/i,
  );
  if (money) out.budget = Math.round(Math.min(MAX_BUDGET, Number(money[1] ?? money[2] ?? money[3])));

  const diets = DIET_WORDS.flatMap((w) => transcript.match(new RegExp(`\\b${w}\\b`, "i"))?.[0].toLowerCase() ?? []);
  if (diets.length) out.dietary = diets.join(", ");
  const availability = cleanText(transcript.match(AVAIL_WORDS)?.[0]);
  if (availability) out.availability = availability;
  const other = cleanText(transcript);
  if (other) out.other = other;
  return out;
}

/** Plain-English restatement for the fallback path. */
export function describePrefs(p: Partial<Preferences>): string {
  const parts: string[] = [];
  if (p.budget !== undefined && p.budget !== null) parts.push(`up to $${p.budget} per person`);
  if (p.dietary) parts.push(`dietary: ${p.dietary}`);
  if (p.availability) parts.push(`free ${p.availability}`);
  return parts.length ? `Heard: ${parts.join("; ")}.` : "Got it. I saved what you said as a note.";
}
