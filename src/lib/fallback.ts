// Last-resort fallback: saved demo plans, used only when the make-plan call itself fails (not deployed,
// network). When make-plan runs but Grok is down, make-plan builds "backup" plans from everyone's private
// answers instead. The browser can't read anyone's answers, so these plans aren't checked against them and
// are never labeled "Fits everyone". Items and prices are copied from data/atlanta-activities.json.

export function buildFallbackPlans(groupId: string, partySize: number) {
  return SAMPLE_PLAN.plans.map((p, i) => ({
    group_id: groupId,
    option_index: i,
    title: p.title,
    summary: p.summary,
    items: p.items,
    per_person_cents: p.per_person_cents,
    total_cents: p.per_person_cents * Math.max(1, partySize),
    fits_everyone: false,
    over_cap_member_ids: [],
    member_notes: [],
    why_it_works: p.why_it_works,
    reasoning: null,
    server_warnings: [],
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
      why_it_works: "Free street art, then a food hall with lots of choices. Reachable by MARTA.",
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
      why_it_works: "Cheap and meaningful history. Both spots are on the streetcar line.",
    },
  ],
};
