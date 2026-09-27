// "Your plan": the winning plan, shown live on every member's phone once the vote is decided. Grok Imagine poster,
// itinerary, Add to calendar (.ics) and Share.
import { useState } from "react";
import { catalogEntry, parseStart } from "../lib/booking";
import { downloadIcs } from "../lib/calendar";
import { type Group, type Member, type Plan, usd } from "../lib/supabase";
import { GrokSays } from "./Grok";
import { Recap } from "./Recap";

type Props = { group: Group; plan: Plan; members: Member[]; painting: boolean };

export function FinalPlan({ group, plan, members, painting }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const votes = members.filter((m) => m.vote_plan_id === plan.id).length;

  function text() {
    return [
      `${group.name}: ${plan.title}`,
      ...plan.items.map((it) => `${it.start_time}: ${it.name}`),
      `About ${usd(plan.per_person_cents)} per person`,
    ].join("\n");
  }
  async function share() {
    const t = text();
    if (navigator.share) {
      try {
        await navigator.share({ title: plan.title, text: t });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(t);
      setNote("Copied to clipboard");
    } catch {
      setNote("Couldn't share on this browser");
    }
    setTimeout(() => setNote(null), 2000);
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl bg-emerald-600 p-4 text-white shadow-md">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">Your plan 🎉</p>
        <h2 className="mt-1 text-2xl font-bold leading-tight">{plan.title}</h2>
        <p className="mt-1 text-sm text-emerald-50">
          {votes} of {members.length} voted for it · about {usd(plan.per_person_cents)} per person
        </p>
      </div>

      <div className="rounded-2xl bg-white p-3 shadow-md">
        <Recap plan={plan} url={plan.recap_image_url ?? group.recap_image_url} painting={painting} />
        <p className="mt-1 px-1 text-[11px] text-gray-500">✨ Your plan poster by Grok Imagine</p>

        <ol className="mt-4 px-1">
          {plan.items.map((it, i) => {
            const t = parseStart(it.start_time);
            const c = catalogEntry(it.catalog_id);
            const last = i === plan.items.length - 1;
            return (
              <li key={i} className="flex gap-3">
                <div className="w-16 shrink-0 pt-0.5 text-right">
                  {t.day && <div className="text-[11px] font-semibold uppercase text-rose-500">{t.day}</div>}
                  <div className="text-sm font-bold leading-tight text-gray-900">{t.time}</div>
                </div>
                <div className="flex flex-col items-center">
                  <span className="mt-1 h-3 w-3 rounded-full border-2 border-indigo-600 bg-white" />
                  {!last && <span className="w-0.5 flex-1 bg-indigo-100" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <p className="font-semibold text-gray-900">{it.name}</p>
                  {c && <p className="text-xs text-gray-500">{c.neighborhood}{c.duration_minutes ? ` · about ${c.duration_minutes} min` : ""}</p>}
                  {it.note && <p className="text-xs text-gray-500">{it.note}</p>}
                  {c?.transit_note && <p className="mt-0.5 text-xs text-gray-400">🚇 {c.transit_note}</p>}
                </div>
              </li>
            );
          })}
        </ol>

        {plan.why_it_works && (
          <GrokSays label="why it fits" className="rounded-xl bg-indigo-50 p-3">
            {plan.why_it_works}
          </GrokSays>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => downloadIcs(plan, group.name)} className="rounded-xl bg-gray-900 p-3 font-semibold text-white hover:bg-gray-800">
          📅 Add to calendar
        </button>
        <button onClick={share} className="rounded-xl border border-gray-300 bg-white p-3 font-semibold text-gray-800 hover:bg-gray-50">
          📤 Share
        </button>
      </div>
      {note && <p className="text-center text-sm text-emerald-700">{note}</p>}
      <p className="text-center text-xs text-gray-400">Prices are estimates from the catalog.</p>
    </section>
  );
}
