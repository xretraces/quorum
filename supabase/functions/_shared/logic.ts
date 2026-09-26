// Pure, dependency-free logic shared by make-plan and pay. Unit-tested in logic.test.ts.

// ------------------------------------------------------------------ types
export type CatalogItem = {
  id: string;
  name: string;
  category: string;
  neighborhood: string;
  price_per_person_cents: number;
  veg_friendly: boolean;
  transit_friendly: boolean;
  typical_hours: string;
  [k: string]: unknown;
};

export type RosterMember = {
  id: string;
  display_name: string;
  budget_cap_cents: number | null;
  dietary?: string | null;
  transport?: string | null;
};

export type ExtractedMember = {
  member_id: string | null;
  name: string;
  budget_cap_cents: number | null;
  dietary: string[];
  availability: string;
  location: string;
  transport: "car" | "transit" | "rideshare" | "walk_bike" | "unknown";
  notes: string;
};

export type ModelPlan = {
  title: string;
  summary: string;
  items: { catalog_id: string; start_time: string; note: string }[];
  total_cents: number;
  per_person_cents: number;
  fits_everyone: boolean;
  over_cap_member_names: string[];
  member_notes: { member_id: string | null; name: string; note: string; within_budget: boolean }[];
  why_it_works: string;
};

export type ModelOutput = {
  members: ExtractedMember[];
  constraints: Record<string, unknown>;
  plans: ModelPlan[];
  reasoning: string;
};

export type NormalizedPlan = {
  option_index: number;
  title: string;
  summary: string;
  items: { catalog_id: string; name: string; start_time: string; note: string; price_per_person_cents: number }[];
  per_person_cents: number;
  total_cents: number;
  fits_everyone: boolean;
  over_cap_member_ids: string[];
  member_notes: ModelPlan["member_notes"];
  why_it_works: string;
  server_warnings: string[];
};

export type MemberUpdate = {
  id: string;
  constraints: ExtractedMember;
  dietary: string | null;
  availability: string | null;
  location: string | null;
  transport: string | null;
  /** Only set when the member never entered a cap themselves. */
  budget_cap_cents?: number;
};

type JsonSchema = Record<string, unknown>;

// ------------------------------------------------------------------ JSON Schema (subset) validator
/** Validates the subset of JSON Schema used by plan.schema.json. Returns a list of error strings. */
export function validateSchema(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  const types = schema.type === undefined ? undefined : ([] as string[]).concat(schema.type as string | string[]);
  if (types && !types.some((t) => matchesType(t, value))) {
    return [`${path}: expected ${types.join("|")}, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`${path}: not one of enum (${JSON.stringify(value)})`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(`^(?:${schema.pattern})$`, "u").test(value)) {
      errors.push(`${path}: does not match pattern`);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items && typeof schema.items === "object") {
      value.forEach((v, i) => errors.push(...validateSchema(schema.items as JsonSchema, v, `${path}[${i}]`)));
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const req of (schema.required ?? []) as string[]) {
      if (!(req in obj)) errors.push(`${path}.${req}: required`);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errors.push(...validateSchema(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: unexpected property`);
    }
  }
  return errors;
}

function matchesType(t: string, v: unknown): boolean {
  switch (t) {
    case "null": return v === null;
    case "array": return Array.isArray(v);
    case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "string": return typeof v === "string";
    case "boolean": return typeof v === "boolean";
    default: return false;
  }
}

/** Deep-clones the schema, strips $schema/$id, and pins plans[].items[].catalog_id to the catalog ids. */
export function schemaForRequest(schema: JsonSchema, catalogIds: string[]): JsonSchema {
  // deno-lint-ignore no-explicit-any
  const s = structuredClone(schema) as Record<string, any>;
  delete s.$schema;
  delete s.$id;
  const catalogIdProp = s.properties.plans.items.properties.items.items.properties.catalog_id;
  catalogIdProp.enum = catalogIds;
  delete catalogIdProp.pattern;
  return s;
}

// ------------------------------------------------------------------ normalization (never trust model math)
const norm = (s: string) => s.trim().toLowerCase();
const isVeg = (dietary: string) => /\b(vegetarian|vegan|veggie|plant[- ]based)\b/i.test(dietary);

export function matchExtraction(roster: RosterMember[], extracted: ExtractedMember[]): Map<string, ExtractedMember> {
  const out = new Map<string, ExtractedMember>();
  for (const m of roster) {
    const hit = extracted.find((e) => e.member_id === m.id) ??
      extracted.find((e) => norm(e.name) === norm(m.display_name)) ??
      extracted.find((e) => norm(e.name).split(/\s+/)[0] === norm(m.display_name).split(/\s+/)[0]);
    if (hit) out.set(m.id, hit);
  }
  return out;
}

/** Effective per-person cap: the member-entered cap wins. Otherwise use the Grok-extracted cap, else null. */
export function effectiveCap(m: RosterMember, ex?: ExtractedMember): number | null {
  if (m.budget_cap_cents !== null && m.budget_cap_cents !== undefined) return m.budget_cap_cents;
  return ex?.budget_cap_cents ?? null;
}

export function normalizeModelOutput(
  out: ModelOutput,
  catalog: CatalogItem[],
  roster: RosterMember[],
): { plans: NormalizedPlan[]; memberUpdates: MemberUpdate[]; warnings: string[] } {
  const warnings: string[] = [];
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const matched = matchExtraction(roster, out.members);
  const partySize = roster.length > 0 ? roster.length : Math.max(1, out.members.length);

  const people = roster.map((m) => {
    const ex = matched.get(m.id);
    const dietary = [m.dietary ?? "", ...(ex?.dietary ?? [])].join(" ");
    return { id: m.id, name: m.display_name, cap: effectiveCap(m, ex), veg: isVeg(dietary) };
  });

  const plans: NormalizedPlan[] = [];
  out.plans.slice(0, 3).forEach((p) => {
    const w: string[] = [];
    const items = p.items.flatMap((it) => {
      const c = byId.get(it.catalog_id);
      if (!c) {
        w.push(`Dropped unknown catalog id "${it.catalog_id}".`);
        return [];
      }
      return [{ catalog_id: c.id, name: c.name, start_time: it.start_time, note: it.note, price_per_person_cents: c.price_per_person_cents }];
    });
    if (items.length === 0) {
      warnings.push(`Plan "${p.title}" dropped: no valid catalog items.`);
      return;
    }
    const perPerson = items.reduce((sum, it) => sum + it.price_per_person_cents, 0);
    if (perPerson !== p.per_person_cents) w.push(`Per-person cost corrected from ${p.per_person_cents} to ${perPerson} cents (catalog prices).`);
    const total = perPerson * partySize;

    const overCap = people.filter((m) => m.cap !== null && perPerson > m.cap);
    const vegViolation = people.some((m) => m.veg) &&
      items.some((it) => byId.get(it.catalog_id)!.category === "food" && !byId.get(it.catalog_id)!.veg_friendly);
    if (vegViolation) w.push("Includes a food stop that is not veg-friendly, but a member is vegetarian/vegan.");
    if (overCap.length > 0 && p.fits_everyone) w.push(`Model claimed this fits everyone, but it exceeds the cap for: ${overCap.map((m) => m.name).join(", ")}.`);
    const fits = p.fits_everyone && overCap.length === 0 && !vegViolation;

    const notes = p.member_notes.map((n) => {
      const person = people.find((m) => m.id === n.member_id) ?? people.find((m) => norm(m.name) === norm(n.name));
      if (!person) return n;
      return { ...n, member_id: person.id, within_budget: person.cap === null ? n.within_budget : perPerson <= person.cap };
    });

    plans.push({
      option_index: plans.length,
      title: p.title,
      summary: p.summary,
      items,
      per_person_cents: perPerson,
      total_cents: total,
      fits_everyone: fits,
      over_cap_member_ids: overCap.map((m) => m.id),
      member_notes: notes,
      why_it_works: p.why_it_works,
      server_warnings: w,
    });
  });

  const memberUpdates: MemberUpdate[] = roster.flatMap((m) => {
    const ex = matched.get(m.id);
    if (!ex) return [];
    const u: MemberUpdate = {
      id: m.id,
      constraints: ex,
      dietary: m.dietary || (ex.dietary.length ? ex.dietary.join(", ") : null),
      availability: ex.availability || null,
      location: ex.location || null,
      transport: m.transport || (ex.transport !== "unknown" ? ex.transport : null),
    };
    if ((m.budget_cap_cents === null || m.budget_cap_cents === undefined) && ex.budget_cap_cents !== null) {
      u.budget_cap_cents = ex.budget_cap_cents;
    }
    return [u];
  });

  return { plans, memberUpdates, warnings };
}

// ------------------------------------------------------------------ payment decisions
/** Stripe's minimum charge for USD is $0.50. */
export const STRIPE_MIN_USD_CENTS = 50;

export type HoldDecision =
  | { kind: "hold"; amount_cents: number; over_cap_reapproved: boolean }
  | { kind: "needs_reapproval"; reason: "over_cap" | "no_cap"; share_cents: number; cap_cents: number | null }
  | { kind: "no_payment_needed"; share_cents: number };

/**
 * amount = min(share, cap). If share > cap (or no cap is known), NO hold is placed until the member
 * explicitly re-approves at least `share` (stored as members.approved_amount_cents).
 */
export function decideHold(shareCents: number, capCents: number | null, approvedAmountCents: number | null): HoldDecision {
  if (shareCents < STRIPE_MIN_USD_CENTS) return { kind: "no_payment_needed", share_cents: shareCents };
  const reapproved = approvedAmountCents !== null && approvedAmountCents >= shareCents;
  if (capCents === null) {
    return reapproved
      ? { kind: "hold", amount_cents: shareCents, over_cap_reapproved: true }
      : { kind: "needs_reapproval", reason: "no_cap", share_cents: shareCents, cap_cents: null };
  }
  if (shareCents <= capCents) return { kind: "hold", amount_cents: Math.min(shareCents, capCents), over_cap_reapproved: false };
  return reapproved
    ? { kind: "hold", amount_cents: shareCents, over_cap_reapproved: true }
    : { kind: "needs_reapproval", reason: "over_cap", share_cents: shareCents, cap_cents: capCents };
}

/** Does this approval cover the share? A cap breach (or unknown cap) needs an explicit amount >= share. */
export function approvalCovers(shareCents: number, capCents: number | null, acceptAmountCents: number | undefined): boolean {
  if (capCents !== null && shareCents <= capCents) return true;
  return acceptAmountCents !== undefined && acceptAmountCents >= shareCents;
}

/** PaymentIntent statuses from which Stripe allows cancel. */
export const CANCELABLE_STATUSES = new Set([
  "requires_payment_method",
  "requires_capture",
  "requires_confirmation",
  "requires_action",
  "processing",
]);

export type CaptureReadiness =
  | { ready: true }
  | { ready: false; pending_approval: string[]; pending_authorization: string[] };

/** All members approved for >= share AND every payable member has a PaymentIntent in requires_capture/succeeded. */
export function captureReadiness(
  shareCents: number,
  members: { id: string; approved: boolean; approved_amount_cents: number | null }[],
  piStatusByMember: Map<string, string>,
): CaptureReadiness {
  const pendingApproval = members
    .filter((m) => !m.approved || (m.approved_amount_cents ?? 0) < shareCents)
    .map((m) => m.id);
  const pendingAuth = shareCents < STRIPE_MIN_USD_CENTS
    ? []
    : members.filter((m) => !["requires_capture", "succeeded"].includes(piStatusByMember.get(m.id) ?? "")).map((m) => m.id);
  if (members.length > 0 && pendingApproval.length === 0 && pendingAuth.length === 0) return { ready: true };
  return { ready: false, pending_approval: pendingApproval, pending_authorization: pendingAuth };
}
