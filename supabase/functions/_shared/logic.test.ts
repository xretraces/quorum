// deno test supabase/functions/_shared/logic.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { CATALOG_FILE } from "./catalog.ts";
import { PLAN_SCHEMA } from "./plan-schema.ts";
import {
  approvalCovers,
  type CatalogItem,
  captureReadiness,
  decideHold,
  type ModelOutput,
  normalizeModelOutput,
  schemaForRequest,
  validateSchema,
} from "./logic.ts";

const catalog = CATALOG_FILE.activities as unknown as CatalogItem[];
const schema = schemaForRequest(PLAN_SCHEMA, catalog.map((c) => c.id));

const roster = [
  { id: "m-maya", display_name: "Maya", budget_cap_cents: 3000, dietary: "vegetarian", transport: "transit" },
  { id: "m-jon", display_name: "Jon", budget_cap_cents: 6000, dietary: null, transport: "car" },
  { id: "m-priya", display_name: "Priya", budget_cap_cents: null, dietary: null, transport: null },
];

const sample: ModelOutput = {
  members: [
    { member_id: "m-maya", name: "Maya", budget_cap_cents: 3000, dietary: ["vegetarian"], availability: "Sat after 1pm", location: "Midtown", transport: "transit", notes: "" },
    { member_id: null, name: "Jon", budget_cap_cents: 6000, dietary: [], availability: "Sat", location: "Decatur", transport: "car", notes: "" },
    { member_id: null, name: "priya", budget_cap_cents: 4000, dietary: [], availability: "Sat afternoon", location: "West End", transport: "unknown", notes: "" },
  ],
  constraints: { party_size: 3, max_per_person_cents: 3000, dietary_union: ["vegetarian"], needs_transit: true, time_window: "Sat 1-6pm", hard_constraints: [], soft_preferences: [] },
  plans: [
    {
      title: "BeltLine + Krog", summary: "Walk and eat", total_cents: 5400, per_person_cents: 1800, fits_everyone: true, over_cap_member_names: [],
      items: [{ catalog_id: "beltline-eastside-trail", start_time: "Sat 1:00 PM", note: "" }, { catalog_id: "krog-street-market", start_time: "Sat 2:15 PM", note: "" }],
      member_notes: [{ member_id: "m-maya", name: "Maya", note: "veg options", within_budget: true }], why_it_works: "cheap + transit",
    },
    {
      title: "Aquarium splurge", summary: "Big day", total_cents: 9000, per_person_cents: 3000 /* wrong on purpose */, fits_everyone: true, over_cap_member_names: [],
      items: [{ catalog_id: "georgia-aquarium", start_time: "Sat 1:00 PM", note: "" }, { catalog_id: "fox-bros-bbq", start_time: "Sat 4:00 PM", note: "" }],
      member_notes: [{ member_id: null, name: "Maya", note: "", within_budget: true }], why_it_works: "",
    },
  ],
  reasoning: "test",
};

Deno.test("sample output validates against request schema", () => {
  assertEquals(validateSchema(schema, sample), []);
});

Deno.test("schema rejects non-catalog ids and extra props", () => {
  // deno-lint-ignore no-explicit-any
  const bad = structuredClone(sample) as unknown as Record<string, any>;
  bad.plans[0].items[0].catalog_id = "made-up-venue";
  bad.plans[0].extra = 1;
  const errs = validateSchema(schema, bad);
  assertEquals(errs.some((e) => e.includes("enum")), true);
  assertEquals(errs.some((e) => e.includes("unexpected property")), true);
});

Deno.test("normalize recomputes money and flags cap + veg violations", () => {
  const { plans, memberUpdates } = normalizeModelOutput(sample, catalog, roster);
  assertEquals(plans.length, 2);
  assertEquals(plans[0].per_person_cents, 1800);
  assertEquals(plans[0].total_cents, 5400);
  assertEquals(plans[0].fits_everyone, true);
  // aquarium 5000 + fox bros 2800 = 7800 > Maya 3000, Jon 6000, Priya (grok) 4000
  assertEquals(plans[1].per_person_cents, 7800);
  assertEquals(plans[1].fits_everyone, false);
  assertEquals(plans[1].over_cap_member_ids.sort(), ["m-jon", "m-maya", "m-priya"]);
  assertEquals(plans[1].member_notes[0].within_budget, false);
  assertEquals(plans[1].server_warnings.length >= 2, true);
  // Priya had no cap -> take Grok's; Maya keeps her own.
  assertEquals(memberUpdates.find((u) => u.id === "m-priya")?.budget_cap_cents, 4000);
  assertEquals(memberUpdates.find((u) => u.id === "m-maya")?.budget_cap_cents, undefined);
});

Deno.test("decideHold: min(share, cap), reapproval, stripe minimum", () => {
  assertEquals(decideHold(2500, 3000, null), { kind: "hold", amount_cents: 2500, over_cap_reapproved: false });
  assertEquals(decideHold(3500, 3000, null).kind, "needs_reapproval");
  assertEquals(decideHold(3500, 3000, 3000).kind, "needs_reapproval");
  assertEquals(decideHold(3500, 3000, 3500), { kind: "hold", amount_cents: 3500, over_cap_reapproved: true });
  assertEquals(decideHold(2000, null, null).kind, "needs_reapproval");
  assertEquals(decideHold(0, 3000, null).kind, "no_payment_needed");
});

Deno.test("approvalCovers + captureReadiness", () => {
  assertEquals(approvalCovers(2500, 3000, undefined), true);
  assertEquals(approvalCovers(3500, 3000, undefined), false);
  assertEquals(approvalCovers(3500, 3000, 3500), true);
  const members = [
    { id: "a", approved: true, approved_amount_cents: 2500 },
    { id: "b", approved: true, approved_amount_cents: 2500 },
  ];
  const s = new Map([["a", "requires_capture"], ["b", "requires_payment_method"]]);
  assertEquals(captureReadiness(2500, members, s), { ready: false, pending_approval: [], pending_authorization: ["b"] });
  s.set("b", "requires_capture");
  assertEquals(captureReadiness(2500, members, s), { ready: true });
  assertEquals(captureReadiness(3000, members, s).ready, false); // stale approval after price change
});
