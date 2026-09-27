// Budget caps: parsing what people type ("under $25", "25 bucks", "$20-30") and the hard per-person cap check make-plan
// runs on its final plan list. Pure code, no Deno APIs, so the web app and the Node tests import it too.
// The cap is the LOWEST budget in the group. Nothing here names whose budget it was.

const MAX_BUDGET = 1000;

/**
 * Max dollars per person from a number or free text, or null when there is no usable amount.
 * "under $25" -> 25, "25 bucks" -> 25, "$1,000" -> 1000, "$20-30" / "20 to 30" -> 30 (a range's top is the cap),
 * "12.50" -> 13 (rounded), "no limit" / "" -> null. Clamped to 0-1000.
 */
export function parseBudget(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const nums = [...v.replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    if (nums.length) n = Math.max(...nums.slice(0, 2));
  }
  if (n === null || !Number.isFinite(n)) return null;
  return Math.round(Math.min(MAX_BUDGET, Math.max(0, n)));
}

/** The group's per-person cap in cents: the lowest budget anyone gave, or null if nobody gave one. */
export function lowestCapCents(budgets: (number | null | undefined)[]): number | null {
  const cents = budgets.flatMap((b) => (typeof b === "number" && Number.isFinite(b) ? [Math.round(b * 100)] : []));
  return cents.length ? Math.min(...cents) : null;
}

type PricedItem = { catalog_id: string; price_per_person_cents: number };

/** Per-person cost of a plan, using the catalog price when the item is known (never trusting a model's number). */
export function planCostCents(items: readonly PricedItem[], priceOf: (id: string) => number | undefined): number {
  return items.reduce((s, i) => s + (priceOf(i.catalog_id) ?? i.price_per_person_cents), 0);
}

/**
 * Hard budget rule on a final plan list: keeps only plans whose per-person cost (recomputed from catalog prices) is at
 * or under the cap, fixes per_person_cents/total_cents to the recomputed cost, and renumbers option_index.
 * `dropped` is how many plans were over (for server logs; says nothing about whose cap it was).
 */
export function enforceBudget<P extends { option_index: number; items: PricedItem[]; per_person_cents: number; total_cents: number }>(
  plans: readonly P[],
  capCents: number | null,
  priceOf: (id: string) => number | undefined,
  partySize: number,
): { plans: P[]; dropped: number } {
  const out: P[] = [];
  for (const p of plans) {
    const per = planCostCents(p.items, priceOf);
    if (capCents !== null && per > capCents) continue;
    const items = p.items.map((i) => ({ ...i, price_per_person_cents: priceOf(i.catalog_id) ?? i.price_per_person_cents }));
    out.push({ ...p, items, per_person_cents: per, total_cents: per * Math.max(1, partySize), option_index: out.length });
  }
  return { plans: out, dropped: plans.length - out.length };
}
