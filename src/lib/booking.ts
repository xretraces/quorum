// Booked-screen helpers: demo booking references, per-member hold/paid state, and itinerary details (times,
// travel legs, diet notes) derived from the plan items plus the shared Atlanta catalog. Nothing here is stored.
import { CATALOG_FILE } from "../../supabase/functions/_shared/catalog.ts";
import { simPaymentOf } from "./payments";
import type { Member, Payment, Plan, PlanItem, SimReason } from "./supabase";

type CatalogEntry = {
  id: string; name: string; category: string; neighborhood: string; veg_friendly: boolean;
  duration_minutes?: number; transit_note?: string; dietary_note?: string;
  /** Real venue photo in public/venues/ (Wikimedia Commons, free license) and its attribution. */
  photo?: string; photoCredit?: { author: string; license: string; source: string };
};
const CATALOG = new Map((CATALOG_FILE.activities as unknown as CatalogEntry[]).map((c) => [c.id, c]));
export const catalogEntry = (id: string) => CATALOG.get(id);
/** Photo + credit + category for a catalog id (category picks the placeholder icon when there's no photo). */
export const venuePhoto = (id: string) => {
  const c = CATALOG.get(id);
  return c && { photo: c.photo, photoCredit: c.photoCredit, category: c.category };
};

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

/** Demo booking reference, stable for a group + stop (FNV-1a hash), e.g. "QRM-7K2P". */
export function bookingRef(groupId: string, stopIndex: number) {
  let h = 0x811c9dc5;
  for (const ch of `${groupId}:${stopIndex}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += REF_ALPHABET[h % REF_ALPHABET.length];
    h = Math.floor(h / REF_ALPHABET.length);
  }
  return `QRM-${code}`;
}

export type Card = { brand: string; last4: string };

/**
 * The card behind a hold. Uses card_brand/card_last4 if the record carries them; payments rows and simulated
 * holds don't today (PayButton doesn't expose the PaymentMethod), so it falls back to Stripe's Visa test card.
 */
export function cardOf(hold: object | null | undefined): Card {
  const r = (hold ?? {}) as { card_brand?: unknown; card_last4?: unknown };
  return {
    brand: typeof r.card_brand === "string" && r.card_brand ? r.card_brand.toLowerCase() : "visa",
    last4: typeof r.card_last4 === "string" && /^\d{4}$/.test(r.card_last4) ? r.card_last4 : "4242",
  };
}

const CARD_ON_FILE = new Set(["requires_capture", "succeeded"]);

/** This member's hold for the locked plan (simulated or Stripe), the amount it covers, and its card once placed. */
export function holdOf(m: Member, plan: Plan, payments: Payment[], simulated: SimReason | null) {
  const hold = simulated ? simPaymentOf(m, plan.id) : payments.find((p) => p.member_id === m.id && p.plan_id === plan.id);
  return {
    status: hold?.status,
    amount_cents: hold?.amount_cents ?? plan.per_person_cents,
    card: hold && CARD_ON_FILE.has(hold.status) ? cardOf(hold) : null,
  };
}

export function payState(plan: Plan, status: string | undefined) {
  if (status === "succeeded") return { label: "Paid", icon: "✅", cls: "bg-emerald-100 text-emerald-700" };
  if (status === "requires_capture") return { label: "Held", icon: "⏳", cls: "bg-indigo-100 text-indigo-700" };
  if (plan.per_person_cents < 50) return { label: "No charge", icon: "✓", cls: "bg-gray-100 text-gray-600" };
  return { label: "Not charged", icon: "–", cls: "bg-amber-100 text-amber-800" };
}

/** "Sat 1:00 PM" → { day: "Sat", time: "1:00 PM", minutes: 780 }. Unparseable times keep the raw text. */
export function parseStart(raw: string) {
  const m = raw.trim().match(/^(?:([A-Za-z]+),?\s+)?(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (!m) return { day: null, time: raw, minutes: null };
  const hour = (Number(m[2]) % 12) + (/p/i.test(m[4]) ? 12 : 0);
  const mins = Number(m[3] ?? 0);
  return {
    day: m[1] ? m[1].slice(0, 3) : null,
    time: `${m[2]}:${String(mins).padStart(2, "0")} ${m[4].toUpperCase()}`,
    minutes: hour * 60 + mins,
  };
}

export type Mode = "car" | "transit" | "rideshare" | "walk_bike" | "unknown";
export const MODE: Record<Mode, { icon: string; label: string; you: string }> = {
  car: { icon: "🚗", label: "Drive", you: "You're driving" },
  transit: { icon: "🚇", label: "Transit", you: "You're taking transit" },
  rideshare: { icon: "🚕", label: "Rideshare", you: "You're taking a rideshare" },
  walk_bike: { icon: "🚲", label: "Walk or bike", you: "You're walking or biking" },
  unknown: { icon: "📍", label: "Next stop", you: "Transport not mentioned" },
};

/** Transport from Grok's extraction (members.constraints.transport), else the free-text members.transport. */
export function transportOf(m: Member): Mode {
  const c = m.constraints?.transport;
  if (typeof c === "string" && c in MODE && c !== "unknown") return c as Mode;
  const t = (m.transport ?? "").toLowerCase();
  if (/car|driv/.test(t)) return "car";
  if (/transit|marta|bus|train|streetcar/.test(t)) return "transit";
  if (/uber|lyft|ride/.test(t)) return "rideshare";
  if (/walk|bike/.test(t)) return "walk_bike";
  return "unknown";
}

export type Leg = { icon: string; label: string; from: string | null; to: string | null; detail: string | null; gapMinutes: number | null };

/** The hop from stop a to stop b for someone travelling by `mode`. Uses catalog data only; no invented travel times. */
export function legBetween(a: PlanItem, b: PlanItem, mode: Mode): Leg {
  const A = catalogEntry(a.catalog_id);
  const B = catalogEntry(b.catalog_id);
  const sameArea = !!A && !!B && A.neighborhood === B.neighborhood;
  const aStart = parseStart(a.start_time).minutes;
  const bStart = parseStart(b.start_time).minutes;
  const aEnd = aStart !== null && A?.duration_minutes ? aStart + A.duration_minutes : null;
  const gap = aEnd !== null && bStart !== null && bStart >= aEnd ? bStart - aEnd : null;
  const walkOver = sameArea && mode !== "car";
  const { icon, label } = walkOver ? { icon: "🚶", label: "Walk over" } : MODE[mode];
  const detail = walkOver
    ? `Both stops are in ${B!.neighborhood}`
    : mode === "transit" || mode === "unknown" || mode === "walk_bike"
      ? B?.transit_note ?? null
      : null;
  return { icon, label, from: A?.neighborhood ?? null, to: B?.neighborhood ?? null, detail, gapMinutes: gap };
}

/** Everything this member said about food: the dietary column plus Grok's extracted list. */
export function dietOf(m: Member): string[] {
  const extracted = Array.isArray(m.constraints?.dietary) ? (m.constraints.dietary as unknown[]).filter((d) => typeof d === "string") : [];
  const all = [...(m.dietary ?? "").split(","), ...(extracted as string[])].map((d) => d.trim()).filter(Boolean);
  return [...new Map(all.map((d) => [d.toLowerCase(), d])).values()];
}

const VEG = /\b(vegetarian|vegan|veggie|plant[- ]based)\b/i;

/** Per-stop diet notes that matter to this member (food stops and catalog diet notes). */
export function dietNotesFor(m: Member, plan: Plan): { stop: string; note: string; ok: boolean }[] {
  const diet = dietOf(m);
  if (diet.length === 0) return [];
  const veg = diet.some((d) => VEG.test(d));
  return plan.items.flatMap((it) => {
    const c = catalogEntry(it.catalog_id);
    if (!c) return [];
    const notes: { stop: string; note: string; ok: boolean }[] = [];
    if (veg && c.category === "food") {
      notes.push({ stop: it.name, ok: c.veg_friendly, note: c.veg_friendly ? "Veg-friendly options" : "Limited vegetarian options" });
    }
    if (c.dietary_note) notes.push({ stop: it.name, ok: true, note: c.dietary_note });
    return notes;
  });
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

const AVATAR_COLORS = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500", "bg-violet-500"];
export function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
