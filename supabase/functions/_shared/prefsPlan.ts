// Plans from the members' private questionnaire answers (make-plan). Pure code, no Deno APIs.
// Grok gets the answers anonymized ("Person 1"...), and the server re-checks every plan against the group's
// hard rules: budget is a per-person cap, vegetarian/vegan answers require veg-friendly food, hard no's pulled
// from "other" ("no bars", "I don't drink", "nothing outdoors") are exclusions, gluten-free / celiac / "GF" answers
// require GF-friendly food (softened to a "check gluten-free options" line when too few GF food stops fit), "I take MARTA" / "no car" means
// transit only, "free after 5pm" style availability becomes a shared time window, and every stop must start and
// end inside the venue's typical opening hours. Anything that fails a hard rule is dropped. The same rules drive
// the no-Grok backup plans.
// Explicit requests ("craving pizza", "quiero pizza", "can we do the aquarium") are MUST-INCLUDE: a solo planner
// gets every plan anchored on one, a group gets at least one plan per request, unless nothing matching passes the
// hard rules. The server checks this and repairs the plan list (honorRequests), for Grok and backup plans alike.
// Nothing stored on a plan names a member or reveals one person's budget or constraints.
import type { CatalogItem } from "./logic.ts";
import { lowestCapCents } from "./budget.ts";
import { normalizePrefs, type Preferences } from "./preferences.ts";
import { matchesRequest, requestKeysOf, requestKind } from "./requests.ts";

export type CatalogEntry = CatalogItem & {
  duration_minutes?: number;
  transit_note?: string;
  tags?: string[];
  /** Food stops only: true when gluten-free options are documented (gf_note says where). Missing/false = not known. */
  gf_friendly?: boolean;
  gf_note?: string;
};

/**
 * "strict": food stops must be gf_friendly (like vegetarian). "soft": someone is gluten-free but too few GF-friendly
 * food stops fit the other rules, so any food is allowed and the plan text says to check gluten-free options.
 */
export type GlutenFreeMode = "off" | "strict" | "soft";

/** What the whole group needs, merged from everyone's answers. Never stored or sent to a browser. */
export type GroupNeeds = {
  partySize: number;
  capCents: number | null; // lowest budget
  vegetarian: boolean;
  glutenFree: GlutenFreeMode; // see settleGlutenFree
  transitOnly: boolean; // someone takes MARTA, the bus, or has no car (from "other"), unless they can rideshare
  windowFrom: number | null; // minutes after midnight, latest "free after" parsed from availability
  windowUntil: number | null; // earliest "free until"
  hardNoTerms: string[]; // from everyone's "other", expanded with synonyms (drink -> bar, brewery, ...)
  anyTimes: boolean;
  requestKeys: string[]; // explicit requests in anyone's dietary/other text ("pizza", "aquarium"), see requests.ts
  requests: GroupRequest[]; // requestKeys that some catalog item can satisfy under the hard rules (settleRequests)
};

/** A must-include request and the catalog ids that satisfy it and pass every hard rule on their own. */
export type GroupRequest = { key: string; label: string; ids: string[] };

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

// Gluten-free, loosely spelled: "gluten free", "gluten-free", "glutenfree", "glutten fre", "GF", "celiac", "coeliac",
// "no gluten", "can't have gluten", "I don't eat gluten", "gluten intolerant", "gluten allergy".
const GLUTEN = String.raw`glu+t+[aeiou]?n`;
export const GLUTEN_FREE = new RegExp(
  String.raw`\b(?:co?eliac|gf|${GLUTEN}[\s-]*fr+e+e?|(?:no|zero|avoid|avoiding|without|non|(?:can'?t|cannot|can not|don'?t|do not|doesn'?t|won'?t) (?:have|eat|do|tolerate)|allergic to|intolerant to|sensitive to)[\s-]+${GLUTEN}|${GLUTEN}[\s-]*(?:intoleran\w*|allerg\w*|sensitiv\w*))\b`,
  "gi",
);
/** A negation earlier in the same clause: "I'm not gluten free", "not celiac", "no longer GF". */
const GF_NEGATED = /(?:\b(?:not|no longer|never)\b|n'?t\b)/i;
/** "my gf", "his GF": girlfriend, not gluten-free. */
const GF_PARTNER = /\b(?:my|his|her|your|their|our|a)\s+$/i;

/**
 * True if the text says the person is gluten-free. Works per clause (split on , ; . ! ? newline and "but"), so
 * "I'm not gluten free" and "gluten is fine" don't count, while "not picky, but gluten-free" does.
 */
export function saysGlutenFree(text: string): boolean {
  for (const clause of unCurl(text).split(/[,;.!?\n]|\bbut\b/i)) {
    for (const m of clause.matchAll(GLUTEN_FREE)) {
      const before = clause.slice(0, m.index);
      if (/^gf$/i.test(m[0]) && GF_PARTNER.test(before)) continue;
      // The positive phrases that contain their own negation ("no gluten", "don't eat gluten") only look before them.
      if (GF_NEGATED.test(before)) continue;
      return true;
    }
  }
  return false;
}

/** Fewer GF-friendly food stops than this (after budget, veg, transit and hard no's) -> "soft" gluten-free mode. */
export const MIN_GF_FOOD = 2;

/** Shown in plan text in "soft" mode. Group-level, names no one. */
export const GF_CHECK_NOTE = "Check gluten-free options with the venue before you go.";

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
  const windows = all.map((p) => parseWindow(p.availability));
  const froms = windows.flatMap((w) => w.from ?? []);
  const untils = windows.flatMap((w) => w.until ?? []);
  let windowFrom: number | null = froms.length ? Math.max(...froms) : null;
  let windowUntil: number | null = untils.length ? Math.min(...untils) : null;
  // No shared window: don't enforce times (Grok is told to find the best compromise).
  if (windowFrom !== null && windowUntil !== null && windowUntil - windowFrom < 60) windowFrom = windowUntil = null;
  return {
    partySize: Math.max(1, partySize),
    capCents: lowestCapCents(all.map((p) => p.budget)),
    vegetarian: all.some((p) => VEG.test(p.dietary)),
    // Strict until settleGlutenFree() checks the catalog. Dietary is the main field; "other" catches "celiac" notes.
    glutenFree: all.some((p) => saysGlutenFree(p.dietary) || saysGlutenFree(p.other)) ? "strict" : "off",
    transitOnly: all.some((p) => TRANSIT.test(unCurl(p.other)) && !RIDESHARE.test(p.other)),
    windowFrom,
    windowUntil,
    hardNoTerms: [...new Set(all.flatMap((p) => hardNoTermsOf(p.other)))],
    anyTimes: all.some((p) => p.availability.trim().length > 0),
    requestKeys: [...new Set(all.flatMap((p) => requestKeysOf(`${p.dietary}\n${p.other}`)))],
    requests: [],
  };
}

/** True if the item can be a plan on its own: some start time inside its hours passes every hard rule. */
export function fitsAlone(c: CatalogEntry, needs: GroupNeeds): boolean {
  const starts = schedule([c], needs);
  return starts !== null && violations([{ c, start: starts[0] }], needs).length === 0;
}

/**
 * Keeps the requests some catalog item can satisfy under the hard rules (budget, hard no's, diet, transit, time).
 * A request that conflicts with someone's hard no or the budget is dropped here, silently: that is the hard rule winning.
 */
export function settleRequests(needs: GroupNeeds, catalog: CatalogEntry[]): GroupNeeds {
  const requests = needs.requestKeys.flatMap((key) => {
    const ids = catalog.filter((c) => matchesRequest(c, key) && fitsAlone(c, needs)).map((c) => c.id);
    return ids.length ? [{ key, label: requestKind(key)?.label ?? key, ids }] : [];
  });
  return { ...needs, requests };
}

/**
 * Keeps gluten-free "strict" only if at least MIN_GF_FOOD GF-friendly food stops also pass budget, veg, transit and
 * hard no's. Otherwise "soft": food isn't filtered on gluten (so plans keep a food stop) and plan text says to check.
 */
export function settleGlutenFree(needs: GroupNeeds, catalog: CatalogEntry[]): GroupNeeds {
  if (needs.glutenFree !== "strict") return needs;
  const fits = catalog.filter((c) =>
    c.category === "food" && c.gf_friendly === true &&
    (!needs.vegetarian || c.veg_friendly) &&
    (!needs.transitOnly || c.transit_friendly) &&
    (needs.capCents === null || c.price_per_person_cents <= needs.capCents) &&
    !hitsHardNo(c, needs.hardNoTerms)
  );
  return fits.length >= MIN_GF_FOOD ? needs : { ...needs, glutenFree: "soft" };
}

/** In "soft" mode, a plan with a food stop that isn't GF-friendly must tell the group to check. */
export function needsGfCheck(needs: GroupNeeds, items: CatalogEntry[]): boolean {
  return needs.glutenFree === "soft" && items.some((c) => c.category === "food" && c.gf_friendly !== true);
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
    if (needs.glutenFree === "strict" && c.category === "food" && c.gf_friendly !== true) out.push(`${c.id}: not gluten-free-friendly`);
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
  if (needs.glutenFree === "strict" && items.some((c) => c.category === "food")) parts.push("gluten-free options");
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

export const PREFS_PLAN_PROMPT = `You are Quorum, the planner inside a group-outing app for friends in Atlanta.
Each person answered a private questionnaire. You get their answers anonymized as "Person 1", "Person 2", ... plus group_rules the server computed from them, and a catalog (already filtered to places that pass the group's hard rules one at a time).
Propose 3 genuinely different plans for ${DAY} (2 only if the catalog can't support 3). No two plans may have the same stops; avoid repeating a stop across plans.
HARD RULES (a plan that breaks one is thrown away):
- Use ONLY catalog items, by exact "id". 1 to 4 items per plan.
- The sum of price_per_person_cents of a plan's items must be <= group_rules.max_per_person_cents (when not null). Free items count.
- Never include anything matching anyone's hard no's: group_rules.hard_no_terms, plus any "no X", "I don't X", "nothing X", "hate X" or "allergic to X" in a person's "other" text. Read them generously: "no heights" excludes rooftops and summits, "I don't drink" excludes bars, breweries and wine or cocktail spots, "nothing outdoors" excludes parks, hikes and picnics.
- If group_rules.vegetarian_food_only, every food item must have veg_friendly = true.
- If group_rules.gluten_free_food_only, every food item must have gf_friendly = true (items that are not food are fine).
- If group_rules.transit_only, every item must have transit_friendly = true.
- If group_rules.time_window is set, every item must start at or after "from" and end (start + duration_minutes) by "until". Respect typical_hours.
MUST-INCLUDE: group_rules.must_include lists explicit requests from the answers ("craving pizza", "quiero sushi", "can we do the aquarium"), each with the catalog ids that satisfy it (those catalog items also carry matches_request).
- If group_rules.solo is true (one person planning alone), EVERY plan must include one of the matching ids for a request, with a different matching place in each plan when there are several, and different other stops, so the three options really differ.
- Otherwise, for EACH request, at least one plan must include one of its matching ids. Spread requests across plans so every person's request shows up somewhere.
- Requests never override the hard rules above; the server already removed any that conflict.
If group_rules.gluten_free_check_note, gluten-free food options are limited: any food item is allowed, but the summary of every plan with a food item that lacks gf_friendly = true must tell the group to check gluten-free options with the venue.
SOFT: honor each person's dietary text (diets, allergies and cravings) and availability in their own words, plus "other" notes, and variety: the plans should reflect THESE answers, not a default itinerary. Use variety_seed only to break ties between equally good options. Only group_rules.time_window is a hard clock window; the rest of the availability text is soft. A null budget, dietary, availability, or other means that person has no preference for it. Do not invent a limit or restriction for a null field.
start_time format: "${DAY} 2:00 PM". Leave a little travel time between stops.
PRIVACY (everyone in the group reads these plans): never mention any person, "Person N", a name, a dollar amount, or one person's constraint. Never write "someone", "one of you" or similar. why_it_fits is ONE short line about the group as a whole, e.g. "Under everyone's budget, vegetarian and gluten-free options, reachable by MARTA". Item notes describe the place, not people. If the text refers to the app or planner, call it Quorum.
Output only the JSON object required by the schema.`;

/** Blank text is no preference, so Grok receives null instead of an empty string. */
const prefText = (s: string) => {
  const t = s.trim();
  return t === "" ? null : t;
};

/** Fisher-Yates with an injectable rng (tests pass a seeded one). Returns a copy. */
export function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Catalog items Grok may use: the ones that pass every hard rule on their own, shuffled when `rng` is given. */
export function catalogForGrok(catalog: CatalogEntry[], needs: GroupNeeds, rng?: () => number): CatalogEntry[] {
  const ok = catalog.filter((c) => fitsAlone(c, needs));
  return rng ? shuffled(ok, rng) : ok;
}

/** Anonymized Grok user message. Names never leave the server. `catalog` should come from catalogForGrok(). */
export function grokPayload(all: Preferences[], needs: GroupNeeds, catalog: CatalogEntry[], varietySeed = 0) {
  const requestOf = (id: string) => needs.requests.find((r) => r.ids.includes(id))?.label ?? null;
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
      gluten_free_food_only: needs.glutenFree === "strict",
      gluten_free_check_note: needs.glutenFree === "soft",
      transit_only: needs.transitOnly,
      time_window: needs.windowFrom !== null || needs.windowUntil !== null
        ? { from: hhmm(needs.windowFrom), until: hhmm(needs.windowUntil) }
        : null,
      hard_no_terms: needs.hardNoTerms,
      solo: needs.partySize === 1,
      must_include: needs.requests.map((r) => ({ request: r.label, catalog_ids: r.ids })),
    },
    variety_seed: varietySeed,
    catalog: catalog.map(({ id, name, category, neighborhood, price_per_person_cents, veg_friendly, gf_friendly, gf_note, transit_friendly, typical_hours, duration_minutes, transit_note, dietary_note, tags }) => ({
      id, name, category, neighborhood, price_per_person_cents, veg_friendly, gf_friendly, gf_note, transit_friendly, typical_hours, duration_minutes, transit_note, dietary_note, tags,
      matches_request: requestOf(id),
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
      title: leaksPrivate(p.title, names) ? titleOf(cs) : asQuorum(p.title),
      summary: withGfCheck(leaksPrivate(p.summary, names) ? summaryOf(cs) : asQuorum(p.summary), needs, cs),
      items: items.map(({ c, it }) => ({ c, start_time: it.start_time, note: leaksPrivate(it.note, names) ? "" : asQuorum(it.note) })),
      why: p.why_it_fits.trim() && !leaksPrivate(p.why_it_fits, names) ? asQuorum(p.why_it_fits) : whyItFits(needs, cs),
    }, needs));
  }
  return { plans: out, dropped };
}

/** User-visible text calls the AI "Quorum", never the model's own name. */
const asQuorum = (s: string) => s.trim().replace(/\bGrok\b/gi, "Quorum");

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

/** Appends GF_CHECK_NOTE when needsGfCheck() and the text doesn't already mention gluten. */
function withGfCheck(text: string, needs: GroupNeeds, cs: CatalogEntry[]): string {
  if (!needsGfCheck(needs, cs) || /gluten/i.test(text)) return text;
  return text ? `${text.replace(/\s+$/, "")} ${GF_CHECK_NOTE}` : GF_CHECK_NOTE;
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
 * Plans from the catalog that pass every hard rule: an activity then a food stop (nearby pairs first), else single
 * stops. Picks up to 3 with no shared stops, always including the cheapest, then honorRequests() anchors them on the
 * group's requests. Deterministic without `rng`; with it (make-plan passes Math.random), ties are broken randomly so
 * the same answers don't always get the same three plans. `notice` is set when the time window had to be dropped.
 */
export function backupPlans(
  catalog: CatalogEntry[],
  needs: GroupNeeds,
  rng?: () => number,
): { plans: PlanRow[]; notice: string | null } {
  const plans = backupPlansStrict(catalog, needs, rng);
  if (plans.length || (needs.windowFrom === null && needs.windowUntil === null)) return { plans, notice: null };
  // Nothing fits the clock window (e.g. "after 11pm"): drop only the window. Budget, food, transit and hard no's stay.
  const loose = { ...needs, windowFrom: null, windowUntil: null };
  const relaxed = backupPlansStrict(catalog, settleRequests(loose, catalog), rng);
  return { plans: relaxed, notice: relaxed.length ? WINDOW_RELAXED_NOTICE : null };
}

type Cand = { cs: CatalogEntry[]; starts: number[]; price: number; near: boolean };

/** Every activity + food pair (and, with `singles`, every single stop) that passes the hard rules, best first. */
function candidates(catalog: CatalogEntry[], needs: GroupNeeds, singles: boolean, rng?: () => number): Cand[] {
  const food = catalog.filter((c) => c.category === "food");
  const fun = catalog.filter((c) => c.category !== "food");
  const cands: Cand[] = [];
  const tryAdd = (cs: CatalogEntry[]) => {
    const starts = schedule(cs, needs);
    if (!starts) return;
    if (violations(cs.map((c, i) => ({ c, start: starts[i] })), needs).length) return;
    cands.push({ cs, starts, price: cs.reduce((s, c) => s + c.price_per_person_cents, 0), near: cs.length === 2 && sameArea(cs[0], cs[1]) });
  };
  for (const a of fun) for (const b of food) tryAdd([a, b]);
  if (singles || cands.length < 3) for (const c of catalog) tryAdd([c]);
  const pool = rng ? shuffled(cands, rng) : cands;
  return pool.sort((x, y) =>
    Number(y.near) - Number(x.near) || y.cs.length - x.cs.length || (rng ? 0 : x.price - y.price)
  );
}

function backupPlansStrict(catalog: CatalogEntry[], needs: GroupNeeds, rng?: () => number): PlanRow[] {
  const cands = candidates(catalog, needs, false, rng);
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
  return honorRequests(picked.map((c, i) => candRow(i, c, needs)), catalog, needs, rng);
}

function candRow(index: number, c: Cand, needs: GroupNeeds): PlanRow {
  return toRow(index, {
    title: titleOf(c.cs),
    summary: withGfCheck(summaryOf(c.cs), needs, c.cs),
    items: c.cs.map((x, j) => ({ c: x, start_time: fmtTime(c.starts[j]), note: x.transit_note ?? "" })),
    why: whyItFits(needs, c.cs),
  }, needs);
}

// ------------------------------------------------------------------ must-include requests
const idsOf = (p: PlanRow) => p.items.map((i) => i.catalog_id);
const sameStops = (a: PlanRow, b: PlanRow) => {
  const x = [...idsOf(a)].sort().join("|");
  return x === [...idsOf(b)].sort().join("|");
};
/** Requests a plan satisfies (by key). */
const keysIn = (p: PlanRow, needs: GroupNeeds) =>
  needs.requests.filter((r) => p.items.some((i) => r.ids.includes(i.catalog_id))).map((r) => r.key);

/** Which requests the plan list still misses. Solo: every plan must be anchored too (reported as "plan:N"). */
export function unmetRequests(plans: PlanRow[], needs: GroupNeeds): string[] {
  const out = needs.requests.filter((r) => !plans.some((p) => keysIn(p, needs).includes(r.key))).map((r) => r.key);
  if (needs.partySize === 1 && needs.requests.length) {
    plans.forEach((p, i) => {
      if (keysIn(p, needs).length === 0) out.push(`plan:${i}`);
    });
  }
  return out;
}

/**
 * Validates and repairs a plan list (Grok's or the backup's) so explicit requests are honored and plans differ:
 * - drops plans with exactly the same stops as an earlier one;
 * - each request missing from every plan replaces a plan that no other request depends on (or fills an empty slot)
 *   with a server-built plan anchored on it;
 * - solo: every plan that isn't anchored on a request is replaced by an anchored one (a different matching place and
 *   different other stops each time), as long as the catalog has one; if it runs out, the plan stays as is;
 * - tops the list up to 3 with non-overlapping backup plans when fewer survived.
 * Replacement plans pass every hard rule (they come from the same candidate builder as the backup plans).
 */
export function honorRequests(plans: PlanRow[], catalog: CatalogEntry[], needs: GroupNeeds, rng?: () => number): PlanRow[] {
  const out: PlanRow[] = [];
  for (const p of plans) if (!out.some((q) => sameStops(p, q))) out.push(p);

  const cands = candidates(catalog, needs, true, rng);
  /** Best candidate (as a row) that shares no stop with the other plans and doesn't reuse a request venue. */
  const pick = (ok: (c: Cand) => boolean, others: PlanRow[]): PlanRow | null => {
    const used = new Set(others.flatMap(idsOf));
    const anchorUsed = (c: Cand) => c.cs.some((x) => needs.requests.some((r) => r.ids.includes(x.id)) && used.has(x.id));
    const fresh = cands.filter((c) => ok(c) && !c.cs.some((x) => used.has(x.id)) && !anchorUsed(c));
    if (!fresh.length) return null;
    // With rng, pick among the few best so repeated runs on the same answers don't return the same plans.
    return candRow(0, fresh[rng ? Math.floor(rng() * Math.min(3, fresh.length)) : 0], needs);
  };
  const anchoredOn = (keys: string[]) => (c: Cand) =>
    c.cs.some((x) => needs.requests.some((r) => keys.includes(r.key) && r.ids.includes(x.id)));

  // Groups (and solo): every request shows up in at least one plan.
  for (const r of needs.requests) {
    if (out.some((p) => keysIn(p, needs).includes(r.key))) continue;
    // A slot to use: an empty one, else a plan whose requests are all covered by another plan (unanchored first, last first).
    const expendable = (i: number) =>
      keysIn(out[i], needs).every((k) => out.some((q, j) => j !== i && keysIn(q, needs).includes(k)));
    let slot = out.length < 3 ? out.length : -1;
    if (slot === -1) {
      const order = [...out.keys()].reverse();
      slot = order.find((i) => keysIn(out[i], needs).length === 0) ?? order.find(expendable) ?? -1;
    }
    if (slot === -1) continue;
    const row = pick(anchoredOn([r.key]), out.filter((_, j) => j !== slot));
    if (row) out[slot] = row;
  }

  // Solo: anchor every plan, spreading the requests.
  if (needs.partySize === 1 && needs.requests.length) {
    for (let i = 0; i < 3; i++) {
      if (i < out.length && keysIn(out[i], needs).length) continue;
      const others = out.filter((_, j) => j !== i);
      const covered = new Set(others.flatMap((p) => keysIn(p, needs)));
      const keys = needs.requests.map((r) => r.key);
      const row = pick(anchoredOn(keys.filter((k) => !covered.has(k))), others) ?? pick(anchoredOn(keys), others);
      if (!row) continue;
      if (i < out.length) out[i] = row;
      else out.push(row);
    }
  }

  // Top up to 3 distinct plans.
  while (out.length < 3) {
    const row = pick(() => true, out);
    if (!row) break;
    out.push(row);
  }
  return out.map((p, i) => ({ ...p, option_index: i }));
}
