// deno test --node-modules-dir=none supabase/functions/_shared/prefsPlan.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { CATALOG_FILE } from "./catalog.ts";
import { type CatalogEntry, groupNeeds, normalizeGrokPlans, readPrefs, saysGlutenFree, settleGlutenFree } from "./prefsPlan.ts";

const catalog = CATALOG_FILE.activities as unknown as CatalogEntry[];
const P = (budget: number | null, dietary = "", availability = "", other = "") => readPrefs({ budget, dietary, availability, other });

Deno.test("saysGlutenFree: loose spellings count", () => {
  for (const s of ["gluten-free", "Gluten Free", "glutenfree", "glutten fre please", "GF", "vegan, GF", "celiac", "Coeliac", "no gluten",
    "can't have gluten", "I can\u2019t have gluten", "I don't eat gluten", "gluten intolerant", "gluten allergy", "not picky, but gluten-free"]) {
    assertEquals(saysGlutenFree(s), true, s);
  }
});

Deno.test("saysGlutenFree: negations, 'gluten is fine' and 'my gf' don't", () => {
  for (const s of ["I'm not gluten free", "I\u2019m not gluten-free, I eat everything", "gluten is fine", "not celiac", "no longer GF",
    "never been gluten free", "isn't GF", "bringing my gf", "fine with gluten", "vegetarian", ""]) {
    assertEquals(saysGlutenFree(s), false, s);
  }
});

Deno.test("gluten-free: strict drops non-GF food, soft keeps it with a check line", () => {
  const strict = settleGlutenFree(groupNeeds([P(40, "celiac"), P(40)], 2), catalog);
  assertEquals(strict.glutenFree, "strict");
  const plan = (id: string) => ({ title: id, summary: "Lunch.", items: [{ catalog_id: id, start_time: "Sat 12:00 PM", note: "" }], why_it_fits: "Fits." });
  const r = normalizeGrokPlans([plan("busy-bee-cafe"), plan("mary-macs-tea-room")], catalog, strict, ["A", "B"]);
  assertEquals(r.plans.map((p) => p.title), ["mary-macs-tea-room"]);
  const soft = { ...strict, glutenFree: "soft" as const };
  const s = normalizeGrokPlans([plan("busy-bee-cafe")], catalog, soft, ["A", "B"]);
  assertEquals(s.plans[0].summary, "Lunch. Check gluten-free options with the venue before you go.");
  assertEquals(settleGlutenFree(groupNeeds([P(15, "celiac"), P(50)], 2), catalog).glutenFree, "soft"); // only 1 GF food stop <= $15
  assertEquals(settleGlutenFree(groupNeeds([P(40, "I'm not gluten free")], 1), catalog).glutenFree, "off");
});
