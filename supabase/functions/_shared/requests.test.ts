// npx tsx --test supabase/functions/_shared/requests.test.ts
// Node test (not Deno) so it runs with the web app's tests: explicit requests are must-include in make-plan.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CATALOG_FILE } from "./catalog.ts";
import {
  backupPlans,
  type CatalogEntry,
  catalogForGrok,
  type GrokPlan,
  groupNeeds,
  type GroupNeeds,
  grokPayload,
  hitsHardNo,
  honorRequests,
  leaksPrivate,
  normalizeGrokPlans,
  type PlanRow,
  readPrefs,
  settleGlutenFree,
  settleRequests,
  unmetRequests,
} from "./prefsPlan.ts";
import { requestKeysOf } from "./requests.ts";

const catalog = CATALOG_FILE.activities as unknown as CatalogEntry[];
const byId = new Map(catalog.map((c) => [c.id, c]));
const P = (budget: number | null, dietary = "", availability = "", other = "") => readPrefs({ budget, dietary, availability, other });
const needsOf = (all: ReturnType<typeof P>[], size = all.length) =>
  settleRequests(settleGlutenFree(groupNeeds(all, size), catalog), catalog);
const has = (p: PlanRow, tag: string) => p.items.some((i) => byId.get(i.catalog_id)?.tags?.includes(tag));
const ids = (p: PlanRow) => p.items.map((i) => i.catalog_id);

/** Seeded rng (mulberry32) so "random" runs are reproducible. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every hard rule the server enforces, re-checked from the plan rows. */
function assertHardRules(plans: PlanRow[], needs: GroupNeeds) {
  for (const p of plans) {
    const cs = ids(p).map((id) => byId.get(id)!);
    if (needs.capCents !== null) assert.ok(p.per_person_cents <= needs.capCents, `${p.title}: over budget`);
    for (const c of cs) {
      assert.ok(!hitsHardNo(c, needs.hardNoTerms), `${p.title}: ${c.id} is a hard no`);
      if (needs.vegetarian && c.category === "food") assert.ok(c.veg_friendly, `${c.id} not veg`);
      if (needs.glutenFree === "strict" && c.category === "food") assert.ok(c.gf_friendly, `${c.id} not GF`);
      if (needs.transitOnly) assert.ok(c.transit_friendly, `${c.id} needs a car`);
    }
  }
}

function assertDistinct(plans: PlanRow[]) {
  const keys = plans.map((p) => [...ids(p)].sort().join("|"));
  assert.equal(new Set(keys).size, plans.length, `duplicate plans: ${keys.join(" / ")}`);
}

test("catalog has real pizza places (and sushi, tacos, burgers, bowling) with the usual fields", () => {
  const pizza = catalog.filter((c) => c.tags?.includes("pizza")).map((c) => c.id);
  for (const id of ["antico-pizza-napoletana", "varuni-napoli", "ammazza-edgewood", "fellinis-pizza-ponce", "grant-central-pizza"]) {
    assert.ok(pizza.includes(id), id);
  }
  for (const tag of ["sushi", "tacos", "burgers", "bowling"]) assert.ok(catalog.some((c) => c.tags?.includes(tag)), tag);
  assert.ok(byId.has("midtown-bowl") && byId.has("the-painted-pin"));
  const keys = ["id", "name", "category", "neighborhood", "price_per_person_cents", "veg_friendly", "transit_friendly", "typical_hours", "duration_minutes", "transit_note", "tags"];
  for (const c of catalog) {
    for (const k of keys) assert.ok(k in c, `${c.id} missing ${k}`);
    assert.ok(Number.isInteger(c.price_per_person_cents) && c.price_per_person_cents >= 0, c.id);
    if (c.category === "food") assert.equal(typeof c.gf_friendly, "boolean", `${c.id} gf_friendly`);
    for (const ph of (c as { photos?: { kind: string }[] }).photos ?? []) assert.notEqual(ph.kind, "ai", `${c.id} has an AI image`);
  }
  assert.equal(new Set(catalog.map((c) => c.id)).size, catalog.length, "duplicate ids");
});

test("requestKeysOf: cravings in any language, voice-style filler, activities", () => {
  const cases: [string, string[]][] = [
    ["uh I'm craving pizza", ["pizza"]],
    ["quiero pizza", ["pizza"]],
    ["Pizza!!", ["pizza"]],
    ["피자 먹고 싶어", ["pizza"]],
    ["मुझे पिज़्ज़ा चाहिए", ["pizza"]],
    ["أريد بيتزا", ["pizza"]],
    ["בא לי פיצה", ["pizza"]],
    ["I have no restrictions and I just want pizza", ["pizza"]],
    ["not picky, craving sushi", ["sushi"]],
    ["tacos or burgers", ["tacos", "burgers"]],
    ["solo bowling night", ["bowling"]],
    ["can we go to the aquarium", ["aquarium"]],
    ["quiero ir al boliche", ["bowling"]],
    ["no pizza", []],
    ["no quiero pizza", []],
    ["I don't really want sushi", []],
    ["pizza is fine", []],
    ["피자 싫어", []],
    ["vegetarian", []],
    ["", []],
  ];
  for (const [text, want] of cases) assert.deepEqual(requestKeysOf(text), want, text);
});

test("solo pizza request: all 3 backup plans are anchored on different pizza places", () => {
  for (const text of ["uh I'm craving pizza", "quiero pizza"]) {
    const needs = needsOf([P(40, "", "", text)], 1);
    assert.deepEqual(needs.requests.map((r) => r.key), ["pizza"]);
    const { plans } = backupPlans(catalog, needs);
    assert.equal(plans.length, 3);
    for (const p of plans) assert.ok(has(p, "pizza"), `${p.title} has no pizza`);
    const pizzaIds = plans.map((p) => ids(p).find((id) => byId.get(id)!.tags!.includes("pizza")));
    assert.equal(new Set(pizzaIds).size, 3, "same pizza place twice");
    assertDistinct(plans);
    assertHardRules(plans, needs);
    assert.deepEqual(unmetRequests(plans, needs), []);
  }
});

test("before the fix every answer got the same plans; now the plans follow the request", () => {
  const plain = backupPlans(catalog, needsOf([P(40)], 1)).plans.map((p) => p.title);
  const pizza = backupPlans(catalog, needsOf([P(40, "craving pizza")], 1)).plans.map((p) => p.title);
  const bowling = backupPlans(catalog, needsOf([P(40, "", "", "bowling")], 1)).plans.map((p) => p.title);
  assert.notDeepEqual(plain, pizza);
  assert.notDeepEqual(pizza, bowling);
});

test("solo bowling: at least 2 of 3 plans go bowling (only 2 alleys in the catalog)", () => {
  const needs = needsOf([P(40, "", "", "solo bowling night")], 1);
  const { plans } = backupPlans(catalog, needs);
  assert.ok(plans.filter((p) => has(p, "bowling")).length >= 2, plans.map((p) => p.title).join(" / "));
  assertDistinct(plans);
  assertHardRules(plans, needs);
});

test("random tie-breaks: plans vary between runs but always honor the request and the hard rules", () => {
  const needs = needsOf([P(40, "craving pizza")], 1);
  const seen = new Set<string>();
  for (let s = 1; s <= 8; s++) {
    const { plans } = backupPlans(catalog, needs, seeded(s));
    for (const p of plans) assert.ok(has(p, "pizza"), p.title);
    assertDistinct(plans);
    assertHardRules(plans, needs);
    seen.add(plans.map((p) => p.title).sort().join(" / "));
  }
  assert.ok(seen.size > 1, "every run returned the same plans");
});

test("group: each member's request appears in at least one plan", () => {
  const all = [P(30, "craving sushi"), P(60, "tacos please"), P(50, "", "", "can we go bowling")];
  // Sushi is over the $30 cap everywhere, so the budget wins and sushi is dropped.
  const needs = needsOf(all);
  assert.deepEqual(needs.requests.map((r) => r.key), ["tacos", "bowling"]);
  const { plans } = backupPlans(catalog, needs);
  assert.ok(plans.some((p) => has(p, "tacos")));
  assert.ok(plans.some((p) => has(p, "bowling")));
  assertDistinct(plans);
  assertHardRules(plans, needs);
});

test("a request never beats a hard no or the budget", () => {
  const hardNo = needsOf([P(40, "pizza"), P(40, "", "", "no pizza")]);
  assert.deepEqual(hardNo.requests, []);
  for (const p of backupPlans(catalog, hardNo).plans) assert.ok(!has(p, "pizza"), p.title);
  const broke = needsOf([P(10, "craving sushi")], 1);
  assert.deepEqual(broke.requests, []);
  // "I don't drink" knocks out the cocktail bowling alley, but Midtown Bowl still fits.
  const sober = needsOf([P(40, "", "", "bowling, I don't drink")], 1);
  assert.deepEqual(sober.requests[0].ids, ["midtown-bowl"]);
});

test("vegetarian + gluten-free + transit: pizza request picks a place that fits all of them", () => {
  const needs = needsOf([P(40, "vegetarian, gluten free, craving pizza", "", "I take MARTA")], 1);
  assert.equal(needs.glutenFree, "strict");
  assert.deepEqual(needs.requests[0].ids, ["ammazza-edgewood"]);
  const { plans } = backupPlans(catalog, needs);
  assert.ok(plans.filter((p) => has(p, "pizza")).length >= 1);
  assertHardRules(plans, needs);
});

test("Grok output that ignores the request is repaired; plan text calls the AI Quorum", () => {
  const needs = needsOf([P(40, "uh I'm craving pizza")], 1);
  const plan = (title: string, id: string, note = ""): GrokPlan => ({
    title, summary: `Grok picked ${title}.`, items: [{ catalog_id: id, start_time: "Sat 2:00 PM", note }], why_it_fits: "Grok thinks it fits.",
  });
  const raw = [plan("Museum", "high-museum-of-art"), plan("Museum", "high-museum-of-art"), plan("Pizza", "fellinis-pizza-ponce")];
  const { plans: valid } = normalizeGrokPlans(raw, catalog, needs, ["Sam"]);
  assert.ok(unmetRequests(valid, needs).length > 0);
  const plans = honorRequests(valid, catalog, needs);
  assert.equal(plans.length, 3);
  for (const p of plans) assert.ok(has(p, "pizza"), p.title);
  assertDistinct(plans);
  assertHardRules(plans, needs);
  assert.deepEqual(plans.map((p) => p.option_index), [0, 1, 2]);
  assert.ok(plans.some((p) => p.title === "Pizza"), "Grok's own pizza plan is kept");
  for (const p of plans) {
    for (const text of [p.title, p.summary, p.why_it_works, ...p.items.map((i) => i.note)]) {
      assert.ok(!/grok/i.test(text), text);
      assert.ok(!leaksPrivate(text, ["Sam"]), text);
    }
  }
});

test("group repair keeps a plan another request depends on", () => {
  const needs = needsOf([P(60, "tacos"), P(60, "", "", "bowling")]);
  const row = (id: string, i: number): PlanRow => ({
    option_index: i, title: id, summary: "", items: [{ catalog_id: id, name: id, start_time: "Sat 1:00 PM", note: "", price_per_person_cents: 0 }],
    per_person_cents: 0, total_cents: 0, fits_everyone: true, why_it_works: "",
  });
  const plans = honorRequests([row("superica-krog", 0), row("high-museum-of-art", 1), row("piedmont-park", 2)], catalog, needs);
  assert.equal(plans[0].title, "superica-krog");
  assert.ok(plans.some((p) => has(p, "bowling")));
  assert.equal(plans.length, 3);
});

test("Grok payload: only hard-rule-safe catalog items, requests as must_include, no names", () => {
  const all = [P(30, "vegetarian, quiero pizza"), P(50, "", "", "no museums")];
  const needs = needsOf(all);
  const allowed = catalogForGrok(catalog, needs, seeded(3));
  assert.ok(allowed.every((c) => c.price_per_person_cents <= 3000 && c.category !== "museum"));
  assert.ok(!allowed.some((c) => c.category === "food" && !c.veg_friendly));
  const payload = grokPayload(all, needs, allowed, 42);
  assert.equal(payload.group_rules.solo, false);
  assert.equal(payload.group_rules.must_include[0].request, "pizza");
  assert.ok(payload.group_rules.must_include[0].catalog_ids.length >= 3);
  assert.ok(payload.catalog.filter((c) => c.matches_request === "pizza").length >= 3);
  assert.equal(payload.variety_seed, 42);
  assert.deepEqual(payload.people.map((p) => p.person), ["Person 1", "Person 2"]);
});
