// Plans from the members' private questionnaire answers (make-plan). Pure code, no Deno APIs.
// Grok gets the answers anonymized ("Person 1"...), and the server re-checks every plan against the group's
// hard rules: budget is a per-person cap, vegetarian/vegan answers require veg-friendly food, hard no's pulled
// from "other" ("no bars", "I don't drink", "nothing outdoors") are exclusions, "I take MARTA" / "no car" means
// transit only, "free after 5pm" style availability becomes a shared time window, and every stop must start and
// end inside the venue's typical opening hours. Anything that fails a hard rule is dropped. The same rules drive
// the no-Grok backup plans.
// Nothing stored on a plan names a member or reveals one person's budget or constraints.
import type { CatalogItem } from "./logic.ts";
import { normalizePrefs, type Preferences } from "./preferences.ts";

export type CatalogEntry = CatalogItem & { duration_minutes?: number; transit_note?: string; tags?: string[] };

/** What the whole group needs, merged from everyone's answers. Never stored or sent to a browser. */
export type GroupNeeds = {
  partySize: number;
  capCents: number | null; // lowest budget
  vegetarian: boolean;
  transitOnly: boolean; // someone takes MARTA, the bus, or has no car (from "other"), unless they can rideshare
  windowFrom: number | null; // minutes after midnight, latest "free after" parsed from availability
  windowUntil: number | null; // earliest "free until"
  hardNoTerms: string[]; // from everyone's "other", expanded with synonyms (drink -> bar, brewery, ...)
  anyTimes: boolean;
};

export type PlanRow = {
  option_index: number;
  title: string;
  summary: string;
  items: { catalog_id: string; name: string; start_time: string; note: string; price_per_person_cents: number }[];
  per_person_cents: number;
  total_cents: number;
  fits_everyone: boolean;
  why_it_works: string;
};

export const DAY = "Sat"; // no date on the questionnaire: plans are for the coming Saturday

// Also catches common misspellings: "vegeterian", "vegitarian", "vegtarian".
const VEG = /\b(veg\w*t[ae]r[iy]?an|vegan|veggie|plant[- ]based)\b/i;

/** Stored jsonb -> Preferences with every key present. */
export function readPrefs(raw: unknown): Preferences {
  const p = normalizePrefs(raw);
  return {
    budget: p.budget ?? null,
    dietary: p.dietary ?? "",
    availability: p.availability ?? "",
    other: p.other ?? "",
  };
}

// ------------------------------------------------------------------ hard no's
const NO_PREFIX = /^(?:i\s+)?(?:no|not|nothing|never|don'?t|won'?t|can'?t|avoid|hate|skip|without|anything)\b\s*(?:with|involving|like|that'?s|at|a|an|any|do|go|eat|want)?\s*/i;
const DRINK = ["bar", "brewery", "beer", "cocktail", "wine", "alcohol"];
// No "park"/"garden": they hit indoor venues by name or tag (MLK National Historical Park, Atlanta History Center).
// Outdoor venues still match through category/tag "outdoors"; "rooftop" keeps open-air Skyline Park out.
const OUTDOOR = ["outdoor", "hike", "picnic", "trail", "rooftop"];
const ALIASES: Record<string, string[]> = {
  drink: DRINK,
  drinks: DRINK,
  drinking: DRINK,
  alcohol: DRINK,
  booze: DRINK,
  bar: DRINK,
  bars: DRINK,
  beer: ["beer", "brewery"],
  brewery: ["beer", "brewery"],
  breweries: ["beer", "brewery"],
  heights: ["rooftop", "summit"],
  height: ["rooftop", "summit"],
  outside: OUTDOOR,
  outdoor: OUTDOOR,
  outdoors: OUTDOOR,
  nature: OUTDOOR,
  hike: ["hike", "summit", "trail"],
  hikes: ["hike", "summit", "trail"],
  hiking: ["hike", "summit", "trail"],
  walking: ["walk", "trail", "hike"],
  museums: ["museum"],
  meat: ["bbq"],
  barbecue: ["bbq"],
  bbq: ["bbq"],
  fish: ["aquarium"],
  golf: ["golf"],
  comedy: ["improv"],
  movies: ["theatre", "cinema"],
  movie: ["theatre", "cinema"],
};

/** Negation that starts a hard no inside free text ("no bars", "I don't drink", "allergic to cats"). */
const NEG = /\b(?:no|not|nothing|never|don'?t|dont|doesn'?t|won'?t|can'?t|cannot|avoid|hate|hates|skip|without|allergic to)\b\s*(.*)$/i;
const FILLER = /^(?:no|not|nothing|never|don'?t|dont|won'?t|i|really|like|likes|want|wanna|to|go|going|do|doing|eat|eating|into|a|an|any|the|with|involving|that'?s|big|fan|of|more|too|much|super|very|at|in|on|anything|something|stuff)\b\s*/i;
/** Negated words that are not activities (placeholders, "no car", "not sure"). */
const NOT_TERMS = new Set([
  "car", "cars", "drive", "driving", "preference", "preferences", "restriction", "restrictions", "problem", "problems",
  "worries", "idea", "sure", "picky", "way", "limit", "limits", "rush", "one",
]);
/** Permission, not a hard no: "I don't mind bars", "no problem with outdoors", "fine with hikes". */
const OK_WITH = /\b(?:(?:don'?t|dont|do not|wouldn'?t) mind|no (?:problem|issue|objection)s? with|(?:fine|ok|okay|cool) with|not (?:against|opposed to))\b/i;
/** "No car but I can Uber": can still reach car-only places, so no transit-only rule. */
const RIDESHARE = /\b(?:uber|lyft|rideshare|ride[- ]share|taxi|carpool|get a ride)\b/i;
/** Getting-around words: set transitOnly, never a hard no. */
export const TRANSIT = /\b(?:marta|transit|bus|train|no car|without a car|(?:don'?t|dont|doesn'?t|can'?t) (?:have a car|drive)|on foot)\b/i;

const unCurl = (s: string) => s.replace(/[\u2018\u2019\u02bc]/g, "'");

function cleanPiece(raw: string): string {
  let t = raw.toLowerCase().replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== t;) {
    prev = t;
    t = t.replace(FILLER, "").trim();
  }
  return t.split(" ").slice(0, 3).join(" ");
}

/**
 * Hard-no phrases in free text. "no bars, I don't drink, nothing outdoors" -> ["bars", "drink", "outdoors"].
 * With `all` (the legacy hardNos field) every piece counts, negated or not: "heights, museums".
 */
export function hardNoPhrases(text: string, all = false): string[] {
  const out: string[] = [];
  for (const clause of unCurl(text).split(/[,;.!?\n]|\bbut\b/i)) {
    if (!all && OK_WITH.test(clause)) continue;
    let rest = clause;
    if (all) rest = clause.trim().replace(NO_PREFIX, "");
    else {
      const m = clause.match(NEG);
      if (!m) continue;
      rest = m[1];
    }
    for (const piece of rest.split(/\b(?:or|and|nor)\b|\//i)) {
      const t = cleanPiece(piece);
      if (t.length >= 3 && !NOT_TERMS.has(t) && !TRANSIT.test(t)) out.push(t);
    }
  }
  return out;
}

/** Hard-no phrases plus synonyms: "I don't drink" -> ["drink", "bar", "brewery", "beer", "cocktail", "wine", ...]. */
export function hardNoTermsOf(text: string, all = false): string[] {
  const out = new Set<string>();
  for (const p of hardNoPhrases(text, all)) {
    out.add(p);
    for (const w of p.split(" ")) for (const a of ALIASES[w] ?? []) out.add(a);
  }
  return [...out];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stem = (w: string) => w.replace(/(?:ing|es|s)$/, "");

/** True if a catalog item hits any hard-no term (name, category, tags, id). */
export function hitsHardNo(item: CatalogEntry, terms: string[]): boolean {
  // Neighborhoods are left out so "no parks" doesn't knock out everything in Inman Park; "Bar-B-Q" isn't a bar.
  const hay = `${item.name} ${item.category} ${(item.tags ?? []).join(" ")} ${item.id}`.toLowerCase().replace(/\bbar-b-q\b/g, "bbq");
  return terms.some((t) => {
    const probes = [...(ALIASES[t] ?? []), t, ...(t.includes(" ") ? [] : [stem(t)])].filter((p) => p.length >= 3);
    return probes.some((p) => new RegExp(`\\b${esc(p)}`).test(hay));
  });
}

// ------------------------------------------------------------------ availability -> time window
const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?!\s*(?:hours?|hrs?|min|minutes|people|ppl|bucks|dollars|\$|%|\d))`;

function clock(h: string, m: string | undefined, ap: string | undefined, side: "from" | "until"): number | null {
  let hour = Number(h);
  const min = Number(m ?? 0);
  if (hour > 24 || min > 59) return null;
  if (ap) {
    if (hour > 12 || hour === 0) return null;
    hour = (hour % 12) + (/p/i.test(ap) ? 12 : 0);
  } else if (!m || hour < 13) {
    // No am/pm on an evening outing: "after 5" is 5 PM, "until 11" is 11 PM, "until 12" is midnight.
    if (side === "from" && hour >= 1 && hour <= 9) hour += 12;
    if (side === "until" && hour >= 1 && hour <= 12) hour += 12;
  }
  return hour * 60 + min;
}

/**
 * Simple window from availability text: "free after 5pm" -> from 17:00, "until 11" -> until 23:00,
 * "6-10pm" / "18:00–23:00" -> both, "busy until 3" -> from 15:00. Anything unclear -> nulls (no rule).
 */
export function parseWindow(text: string): { from: number | null; until: number | null } {
  const s = text.toLowerCase().replace(/[\u2013\u2014]/g, "-").replace(/\bmidnight\b/g, "24:00").replace(/\bnoon\b/g, "12:00");
  let from: number | null = null;
  let until: number | null = null;
  const range = s.match(new RegExp(String.raw`\b${CLOCK}\s*(?:-|to)\s*${CLOCK}`));
  if (range) {
    from = clock(range[1], range[2], range[3] ?? (range[2] ? undefined : range[6]), "from");
    until = clock(range[4], range[5], range[6], "until");
  } else {
    const busy = s.match(new RegExp(String.raw`\b(?:busy|work|working|class|classes)\b[^,.;]*?\b(?:until|till|til)\s*${CLOCK}`));
    const after = busy ?? s.match(new RegExp(String.raw`\b(?:after|from|starting(?: at)?|free at)\s*${CLOCK}`));
    if (after) from = clock(after[1], after[2], after[3], "from");
    const rest = busy ? s.replace(busy[0], "") : s;
    const before = rest.match(new RegExp(String.raw`\b(?:until|till|til|before)\s*${CLOCK}`));
    if (before) until = clock(before[1], before[2], before[3], "until");
  }
  if (from !== null && until !== null && until <= from) return { from: null, until: null };
  return { from, until };
}

// ------------------------------------------------------------------ needs + checks
export function groupNeeds(all: Preferences[], partySize: number): GroupNeeds {
  const budgets = all.flatMap((p) => (p.budget === null ? [] : [Math.round(p.budget * 100)]));
  const windows = all.map((p) => parseWindow(p.availability));
  const froms = windows.flatMap((w) => w.from ?? []);
  const untils = windows.flatMap((w) => w.until ?? []);
  let windowFrom: number | null = froms.length ? Math.max(...froms) : null;
  let windowUntil: number | null = untils.length ? Math.min(...untils) : null;
  // No shared window: don't enforce times (Grok is told to find the best compromise).
  if (windowFrom !== null && windowUntil !== null && windowUntil - windowFrom < 60) windowFrom = windowUntil = null;
  return {
    partySize: Math.max(1, partySize),
    capCents: budgets.length ? Math.min(...budgets) : null,
    vegetarian: all.some((p) => VEG.test(p.dietary)),
    transitOnly: all.some((p) => TRANSIT.test(unCurl(p.other)) && !RIDESHARE.test(p.other)),
    windowFrom,
    windowUntil,
    hardNoTerms: [...new Set(all.flatMap((p) => hardNoTermsOf(p.other)))],
    anyTimes: all.some((p) => p.availability.trim().length > 0),
  };
}

/** "Sat 2:00 PM" / "2 PM" / "14:00" -> minutes after midnight, or null. */
export function startMinutes(raw: string): number | null {
  const s = raw.trim();
  const ampm = s.match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/);
  if (ampm) return ((Number(ampm[1]) % 12) + (/p/i.test(ampm[3]) ? 12 : 0)) * 60 + Number(ampm[2] ?? 0);
  const h24 = s.match(/(\d{1,2}):(\d{2})$/);
  return h24 ? Number(h24[1]) * 60 + Number(h24[2]) : null;
}

export const fmtTime = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  return `${DAY} ${((h + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const durationOf = (c: CatalogEntry) => c.duration_minutes ?? 90;

/**
 * Hours a stop can use, from typical_hours: "Daily ~11:00-21:00" -> 11:00-21:00; words only: "daylight" /
 * "dawn-dusk" -> 07:00-20:00, "afternoons-late night" -> 12:00-24:00, "Thu-Sat evenings" -> 17:00-23:00.
 * Null when there is nothing to go on: not enforced.
 */
function openHours(c: CatalogEntry): [number, number] | null {
  const h = c.typical_hours;
  const m = h.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (m) return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
  if (/\b(?:daylight|dawn|dusk)\b/i.test(h)) return [7 * 60, 20 * 60];
  if (/\bafternoons?\b/i.test(h)) return [12 * 60, 24 * 60];
  if (/\bevenings?\b/i.test(h)) return [17 * 60, 23 * 60];
  return null;
}

/** Why a plan breaks the group's hard rules (empty = fits everyone). Reasons are for server logs only. */
export function violations(items: { c: CatalogEntry; start: number | null }[], needs: GroupNeeds): string[] {
  const out: string[] = [];
  const price = items.reduce((s, i) => s + i.c.price_per_person_cents, 0);
  if (needs.capCents !== null && price > needs.capCents) out.push("over budget");
  for (const { c, start } of items) {
    if (needs.vegetarian && c.category === "food" && !c.veg_friendly) out.push(`${c.id}: not veg-friendly`);
    if (needs.transitOnly && !c.transit_friendly) out.push(`${c.id}: not reachable without a car`);
    if (hitsHardNo(c, needs.hardNoTerms)) out.push(`${c.id}: hard no`);
    const open = openHours(c);
    if (open && start !== null && (start < open[0] || start + durationOf(c) > open[1])) out.push(`${c.id}: closed then`);
    if (needs.windowFrom !== null || needs.windowUntil !== null) {
      if (start === null) out.push(`${c.id}: unreadable start time`);
      else {
        if (needs.windowFrom !== null && start < needs.windowFrom) out.push(`${c.id}: starts too early`);
        if (needs.windowUntil !== null && start + durationOf(c) > needs.windowUntil) out.push(`${c.id}: ends too late`);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ privacy of plan text
/** Singling out one member: "someone is vegan", "one of you can't drink", "a friend who hates heights". */
const SINGLES_OUT = /\b(?:someone|somebody|one of (?:you|us|the group|your group|them)|one (?:person|member|friend)|(?:a|your) (?:member|friend|buddy) who|anyone who|whoever|except (?:for )?one)\b/i;

/** True if text could name a member, single one out, or reveal someone's money ("$25", "25 bucks", "Person 2"). */
export function leaksPrivate(text: string, names: string[]): boolean {
  if (/\$|\b\d+\s*(?:dollars?|bucks|usd)\b|\bperson\s*\d/i.test(text)) return true;
  if (SINGLES_OUT.test(text)) return true;
  return names.some((n) => n.trim().length >= 2 && new RegExp(`\\b${esc(n.trim())}\\b`, "i").test(text));
}

/** Server-written "why it fits": only group-level facts the server verified. */
export function whyItFits(needs: GroupNeeds, items: CatalogEntry[]): string {
  const parts: string[] = [];
  if (needs.capCents !== null) parts.push("under everyone's budget");
  if (needs.vegetarian && items.some((c) => c.category === "food")) parts.push("vegetarian-friendly food");
  if (needs.transitOnly) parts.push("reachable by MARTA");
  if (needs.windowFrom !== null || needs.windowUntil !== null) parts.push("fits everyone's free time");
  if (needs.hardNoTerms.length) parts.push("skips everyone's hard no's");
  if (parts.length === 0) parts.push("a good mix of food and fun for the group");
  const s = parts.slice(0, 3).join(", ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

// ------------------------------------------------------------------ Grok
export type GrokPlan = {
  title: string;
  summary: string;
  items: { catalog_id: string; start_time: string; note: string }[];
  why_it_fits: string;
};

export const PREFS_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["plans"],
  properties: {
    plans: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "items", "why_it_fits"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 80 },
          summary: { type: "string", maxLength: 300 },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["catalog_id", "start_time", "note"],
              properties: {
                catalog_id: { type: "string", pattern: "[a-z0-9-]+" }, // enum of catalog ids injected at runtime
                start_time: { type: "string", maxLength: 40, description: "e.g. 'Sat 2:00 PM'" },
                note: { type: "string", maxLength: 160 },
              },
            },
          },
          why_it_fits: { type: "string", maxLength: 200 },
        },
      },
    },
  },
} as const;

export const PREFS_PLAN_PROMPT = `You are Grok, the planner inside Quorum, a group-outing app for friends in Atlanta.
Each person answered a private questionnaire. You get their answers anonymized as "Person 1", "Person 2", ... plus group_rules the server computed from them, and a catalog.
Propose 2 or 3 meaningfully different plans for ${DAY}.
HARD RULES (a plan that breaks one is thrown away):
- Use ONLY catalog items, by exact "id". 1 to 4 items per plan.
- The sum of price_per_person_cents of a plan's items must be <= group_rules.max_per_person_cents (when not null). Free items count.
- Never include anything matching anyone's hard no's: group_rules.hard_no_terms, plus any "no X", "I don't X", "nothing X", "hate X" or "allergic to X" in a person's "other" text. Read them generously: "no heights" excludes rooftops and summits, "I don't drink" excludes bars, breweries and wine or cocktail spots, "nothing outdoors" excludes parks, hikes and picnics.
- If group_rules.vegetarian_food_only, every food item must have veg_friendly = true.
- If group_rules.transit_only, every item must have transit_friendly = true.
- If group_rules.time_window is set, every item must start at or after "from" and end (start + duration_minutes) by "until". Respect typical_hours.
SOFT: honor each person's dietary text and availability in their own words, plus "other" notes, and variety (e.g. a free/cheap plan, a food-focused one, something special). Only group_rules.time_window is a hard clock window; the rest of the availability text is soft. A null budget, dietary, availability, or other means that person has no preference for it. Do not invent a limit or restriction for a null field.
start_time format: "${DAY} 2:00 PM". Leave a little travel time between stops.
PRIVACY (everyone in the group reads these plans): never mention any person, "Person N", a name, a dollar amount, or one person's constraint. Never write "someone", "one of you" or similar. why_it_fits is ONE short line about the group as a whole, e.g. "Under everyone's budget, vegetarian and gluten-free options, reachable by MARTA". Item notes describe the place, not people.
Output only the JSON object required by the schema.`;

/** Blank text is no preference, so Grok receives null instead of an empty string. */
const prefText = (s: string) => {
  const t = s.trim();
  return t === "" ? null : t;
};

/** Anonymized Grok user message. Names never leave the server. */
export function grokPayload(all: Preferences[], needs: GroupNeeds, catalog: CatalogEntry[]) {
  const hhmm = (m: number | null) => (m === null ? null : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return {
    party_size: needs.partySize,
    people: all.map((p, i) => ({
      person: `Person ${i + 1}`,
      max_per_person_dollars: p.budget,
      dietary: prefText(p.dietary),
      availability: prefText(p.availability),
      other: prefText(p.other),
    })),
    group_rules: {
      max_per_person_cents: needs.capCents,
      vegetarian_food_only: needs.vegetarian,
      transit_only: needs.transitOnly,
      time_window: needs.windowFrom !== null || needs.windowUntil !== null
        ? { from: hhmm(needs.windowFrom), until: hhmm(needs.windowUntil) }
        : null,
      hard_no_terms: needs.hardNoTerms,
    },
    catalog: catalog.map(({ id, name, category, neighborhood, price_per_person_cents, veg_friendly, transit_friendly, typical_hours, duration_minutes, transit_note, dietary_note }) => ({
      id, name, category, neighborhood, price_per_person_cents, veg_friendly, transit_friendly, typical_hours, duration_minutes, transit_note, dietary_note,
    })),
  };
}

/** Grok output -> plan rows. Prices come from the catalog; plans that break a hard rule are dropped. */
export function normalizeGrokPlans(
  plans: GrokPlan[],
  catalog: CatalogEntry[],
  needs: GroupNeeds,
  names: string[],
): { plans: PlanRow[]; dropped: string[] } {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const out: PlanRow[] = [];
  const dropped: string[] = [];
  for (const p of plans.slice(0, 3)) {
    const items = p.items.flatMap((it) => {
      const c = byId.get(it.catalog_id);
      return c ? [{ c, start: startMinutes(it.start_time), it }] : [];
    });
    const bad = items.length === 0 ? ["no catalog items"] : violations(items, needs);
    if (bad.length) {
      dropped.push(`"${p.title}": ${bad.join("; ")}`);
      continue;
    }
    const cs = items.map((i) => i.c);
    out.push(toRow(out.length, {
      title: leaksPrivate(p.title, names) ? titleOf(cs) : p.title.trim(),
      summary: leaksPrivate(p.summary, names) ? summaryOf(cs) : p.summary.trim(),
      items: items.map(({ c, it }) => ({ c, start_time: it.start_time, note: leaksPrivate(it.note, names) ? "" : it.note.trim() })),
      why: p.why_it_fits.trim() && !leaksPrivate(p.why_it_fits, names) ? p.why_it_fits.trim() : whyItFits(needs, cs),
    }, needs));
  }
  return { plans: out, dropped };
}

function toRow(
  index: number,
  p: { title: string; summary: string; items: { c: CatalogEntry; start_time: string; note: string }[]; why: string },
  needs: GroupNeeds,
): PlanRow {
  const per = p.items.reduce((s, i) => s + i.c.price_per_person_cents, 0);
  return {
    option_index: index,
    title: p.title,
    summary: p.summary,
    items: p.items.map(({ c, start_time, note }) => ({
      catalog_id: c.id, name: c.name, start_time, note, price_per_person_cents: c.price_per_person_cents,
    })),
    per_person_cents: per,
    total_cents: per * needs.partySize,
    fits_everyone: true, // only plans that pass every hard rule get here
    why_it_works: p.why,
  };
}

const shortName = (c: CatalogEntry) => c.name.replace(/\s*\(.*\)$/, "").replace(/^Atlanta BeltLine /, "BeltLine ");
const titleOf = (cs: CatalogEntry[]) => cs.map(shortName).join(" + ");
const summaryOf = (cs: CatalogEntry[]) => `${cs.map(shortName).join(", then ")}.`;

// ------------------------------------------------------------------ backup plans (no Grok)
/** Opening hours from "Daily ~11:00-21:00"; unknown hours count as 10:00-22:00. */
function hoursOf(c: CatalogEntry): [number, number] {
  return openHours(c) ?? [600, 1320];
}

const roundUp15 = (m: number) => Math.ceil(m / 15) * 15;

/** Schedules items back to back (15 min between stops) from the window start, inside opening hours. */
function schedule(cs: CatalogEntry[], needs: GroupNeeds): number[] | null {
  let t = needs.windowFrom ?? 12 * 60;
  const starts: number[] = [];
  for (const c of cs) {
    const [open, close] = hoursOf(c);
    t = roundUp15(Math.max(t, open));
    if (t + durationOf(c) > close) return null;
    starts.push(t);
    t += durationOf(c) + 15;
  }
  return starts; // the free window itself is checked by violations()
}

const areaWords = (c: CatalogEntry) => c.neighborhood.toLowerCase().split(/\s*\/\s*/);
const sameArea = (a: CatalogEntry, b: CatalogEntry) => areaWords(a).some((w) => areaWords(b).includes(w));

/** Shown to the whole group when the backup plans had to ignore the shared free time. Names no one. */
export const WINDOW_RELAXED_NOTICE = "Nothing open fits everyone's free time, so these plans use different times.";

/**
 * Deterministic plans from the catalog that pass every hard rule: an activity then a food stop (nearby pairs
 * first), else single stops. Picks up to 3 with no shared stops, always including the cheapest.
 * `notice` is set when the time window had to be dropped.
 */
export function backupPlans(catalog: CatalogEntry[], needs: GroupNeeds): { plans: PlanRow[]; notice: string | null } {
  const plans = backupPlansStrict(catalog, needs);
  if (plans.length || (needs.windowFrom === null && needs.windowUntil === null)) return { plans, notice: null };
  // Nothing fits the clock window (e.g. "after 11pm"): drop only the window. Budget, food, transit and hard no's stay.
  const relaxed = backupPlansStrict(catalog, { ...needs, windowFrom: null, windowUntil: null });
  return { plans: relaxed, notice: relaxed.length ? WINDOW_RELAXED_NOTICE : null };
}

function backupPlansStrict(catalog: CatalogEntry[], needs: GroupNeeds): PlanRow[] {
  const food = catalog.filter((c) => c.category === "food");
  const fun = catalog.filter((c) => c.category !== "food");
  type Cand = { cs: CatalogEntry[]; starts: number[]; price: number; near: boolean };
  const cands: Cand[] = [];
  const tryAdd = (cs: CatalogEntry[]) => {
    const starts = schedule(cs, needs);
    if (!starts) return;
    if (violations(cs.map((c, i) => ({ c, start: starts[i] })), needs).length) return;
    cands.push({ cs, starts, price: cs.reduce((s, c) => s + c.price_per_person_cents, 0), near: cs.length < 2 || sameArea(cs[0], cs[1]) });
  };
  for (const a of fun) for (const b of food) tryAdd([a, b]);
  if (cands.length < 3) for (const c of catalog) tryAdd([c]);

  cands.sort((x, y) => Number(y.near) - Number(x.near) || y.cs.length - x.cs.length || x.price - y.price);
  const cheapest = [...cands].sort((x, y) => x.price - y.price)[0];
  const picked: Cand[] = [];
  for (const c of [cheapest, ...cands]) {
    if (!c || picked.length === 3) break;
    const used = new Set(picked.flatMap((p) => p.cs.map((x) => x.id)));
    const cats = new Set(picked.map((p) => p.cs[0].category));
    if (c.cs.some((x) => used.has(x.id))) continue;
    if (picked.length === 1 && cats.has(c.cs[0].category) && cands.some((o) => !cats.has(o.cs[0].category) && !o.cs.some((x) => used.has(x.id)))) continue;
    picked.push(c);
  }
  return picked.map((c, i) =>
    toRow(i, {
      title: titleOf(c.cs),
      summary: summaryOf(c.cs),
      items: c.cs.map((x, j) => ({ c: x, start_time: fmtTime(c.starts[j]), note: x.transit_note ?? "" })),
      why: whyItFits(needs, c.cs),
    }, needs)
  );
}
