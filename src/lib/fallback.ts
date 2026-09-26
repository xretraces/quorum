// Demo-safe fallback: saved plans for the demo conversation (Maya / Jon / Priya, see README), used only when
// the make-plan call fails. Items and prices are copied from data/atlanta-activities.json; fit and over-cap
// flags are recomputed here against the real roster, same as the server does for Grok output.
import type { Member } from "./supabase";

export function buildFallbackPlans(groupId: string, members: Member[], hardCap: boolean) {
  const partySize = Math.max(1, members.length);
  const candidates = SAMPLE_PLAN.plans.map((p) => {
    const over = members.filter((m) => m.budget_cap_cents !== null && p.per_person_cents > m.budget_cap_cents);
    return { p, over };
  });
  const chosen = hardCap ? candidates.filter((c) => c.over.length === 0) : candidates;
  return chosen.map(({ p, over }, i) => ({
    group_id: groupId,
    option_index: i,
    title: p.title,
    summary: p.summary,
    items: p.items,
    per_person_cents: p.per_person_cents,
    total_cents: p.per_person_cents * partySize,
    fits_everyone: over.length === 0,
    over_cap_member_ids: over.map((m) => m.id),
    member_notes: members.map((m) => {
      const cap = m.budget_cap_cents;
      const within = cap === null || p.per_person_cents <= cap;
      const diff = cap === null ? "" : within ? `$${(cap - p.per_person_cents) / 100} under your cap` : `$${(p.per_person_cents - cap) / 100} over your cap`;
      return { member_id: m.id, name: m.display_name, note: diff || "No cap set", within_budget: within };
    }),
    why_it_works: over.length > 0 ? `${p.why_it_works} Over cap for: ${over.map((m) => m.display_name).join(", ")}.` : p.why_it_works,
    reasoning: "Saved demo plan (live Grok call failed).",
    server_warnings: ["Demo fallback: saved sample plan, not generated live by Grok."],
    model: "demo-fallback",
  }));
}

export const SAMPLE_PLAN = {
  plans: [
    {
      title: "BeltLine Walk + Krog Market",
      summary: "Free street art walk on the BeltLine, then lunch at the food hall",
      items: [
        {
          catalog_id: "beltline-eastside-trail",
          name: "Atlanta BeltLine Eastside Trail walk",
          start_time: "Sat 1:00 PM",
          note: "Free, transit-friendly, great street art",
          price_per_person_cents: 0,
        },
        {
          catalog_id: "krog-street-market",
          name: "Krog Street Market",
          start_time: "Sat 2:30 PM",
          note: "Lots of veggie options",
          price_per_person_cents: 1800,
        },
      ],
      per_person_cents: 1800,
      fits_everyone: true,
      why_it_works: "Free activity + affordable food hall with variety. Everyone can get transit there and eat within budget.",
    },
    {
      title: "Ponce City + Skyline Park",
      summary: "Food hall lunch then rooftop games with skyline views",
      items: [
        {
          catalog_id: "ponce-city-market-food-hall",
          name: "Ponce City Market Food Hall",
          start_time: "Sat 12:00 PM",
          note: "Tons of options for everyone",
          price_per_person_cents: 2000,
        },
        {
          catalog_id: "skyline-park-pcm",
          name: "Skyline Park (Ponce City Market rooftop)",
          start_time: "Sat 2:00 PM",
          note: "Mini golf, games, great views",
          price_per_person_cents: 2200,
        },
      ],
      per_person_cents: 4200,
      fits_everyone: false,
      why_it_works: "The splurge: rooftop games and skyline views after a food-hall lunch.",
    },
    {
      title: "MLK Park + Sweet Auburn",
      summary: "Free historic walk then budget-friendly local eats",
      items: [
        {
          catalog_id: "mlk-national-historical-park",
          name: "Martin Luther King Jr. National Historical Park",
          start_time: "Sat 11:00 AM",
          note: "Free admission, powerful history",
          price_per_person_cents: 0,
        },
        {
          catalog_id: "sweet-auburn-curb-market",
          name: "Sweet Auburn Curb Market",
          start_time: "Sat 1:00 PM",
          note: "Historic market, budget-friendly",
          price_per_person_cents: 1500,
        },
      ],
      per_person_cents: 1500,
      fits_everyone: true,
      why_it_works: "The cheapest option with meaningful history. Both spots are on the streetcar line.",
    },
  ],
};
