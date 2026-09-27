// node --experimental-strip-types --test supabase/functions/_shared/budget.test.ts
// The budget cap is hard: every final plan must cost <= the lowest budget in the group.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { enforceBudget, lowestCapCents, parseBudget, planCostCents } from "./budget.ts";
import { normalizePrefs } from "./preferences.ts";

test("parseBudget reads typed and spoken amounts", () => {
  assert.equal(parseBudget(25), 25);
  assert.equal(parseBudget("25"), 25);
  assert.equal(parseBudget("$25"), 25);
  assert.equal(parseBudget("under $25"), 25);
  assert.equal(parseBudget("Under 25 bucks"), 25);
  assert.equal(parseBudget("less than $25 per person"), 25);
  assert.equal(parseBudget("$20-30"), 30);
  assert.equal(parseBudget("20 to 30 dollars"), 30);
  assert.equal(parseBudget("$1,000"), 1000);
  assert.equal(parseBudget("12.50"), 13);
  assert.equal(parseBudget(5000), 1000);
  assert.equal(parseBudget(-3), 0);
  assert.equal(parseBudget(""), null);
  assert.equal(parseBudget("no limit"), null);
  assert.equal(parseBudget(null), null);
  assert.equal(parseBudget(Number.NaN), null);
});

test("normalizePrefs keeps a budget saved as text like 'under $25'", () => {
  assert.equal(normalizePrefs({ budget: "under $25" }).budget, 25);
  assert.equal(normalizePrefs({ budget: 40 }).budget, 40);
  assert.equal(normalizePrefs({ budget: "whatever" }).budget, undefined);
});

test("lowestCapCents takes the lowest budget and ignores blanks", () => {
  assert.equal(lowestCapCents([null, 60, 25, undefined]), 2500);
  assert.equal(lowestCapCents([null, null]), null);
  assert.equal(lowestCapCents([]), null);
});

const prices: Record<string, number> = { cheap: 1000, mid: 2000, pricey: 4500, free: 0 };
const priceOf = (id: string) => prices[id];
const plan = (i: number, ids: string[], claimed = 0) => ({
  option_index: i,
  title: ids.join("+"),
  items: ids.map((id) => ({ catalog_id: id, price_per_person_cents: claimed })),
  per_person_cents: claimed,
  total_cents: claimed,
});

test("planCostCents uses catalog prices over the model's numbers", () => {
  assert.equal(planCostCents(plan(0, ["cheap", "mid"], 1).items, priceOf), 3000);
  assert.equal(planCostCents([{ catalog_id: "unknown", price_per_person_cents: 700 }], priceOf), 700);
});

test("enforceBudget drops every plan over the lowest cap and renumbers", () => {
  const cap = lowestCapCents([80, 25]); // solo planner had $80, the new member is under $25
  const { plans, dropped } = enforceBudget([plan(0, ["pricey"]), plan(1, ["cheap", "free"]), plan(2, ["cheap", "mid"])], cap, priceOf, 2);
  assert.equal(dropped, 2);
  assert.deepEqual(plans.map((p) => p.title), ["cheap+free"]);
  assert.equal(plans[0].option_index, 0);
  assert.equal(plans[0].per_person_cents, 1000);
  assert.equal(plans[0].total_cents, 2000);
  for (const p of plans) assert.ok(p.per_person_cents <= cap!);
});

test("enforceBudget keeps a plan exactly at the cap and everything when there is no cap", () => {
  assert.equal(enforceBudget([plan(0, ["cheap", "mid"])], 3000, priceOf, 1).plans.length, 1);
  assert.equal(enforceBudget([plan(0, ["pricey"]), plan(1, ["mid"])], null, priceOf, 1).plans.length, 2);
});
