// "Your plan": the winning plan, shown live on every member's phone once the vote is decided. Grok Imagine poster,
// itinerary, Add to calendar (.ics) and Share.
import { useState } from "react";
import { catalogEntry } from "../lib/booking";
import { localStart } from "../i18n/format";
import { useLanguage, useT } from "../i18n/hooks";
import { usePlanTranslation } from "../i18n/usePlanTranslation";
import { downloadIcs } from "../lib/calendar";
import { type Group, type Member, type Plan, usd } from "../lib/supabase";
import { GrokSays } from "./Grok";
import { Recap } from "./Recap";

type Props = { group: Group; plan: Plan; members: Member[]; painting: boolean };

export function FinalPlan({ group, plan: original, members, painting }: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const { plan, transitNotes, pending } = usePlanTranslation(original);
  const shimmer = pending ? "shimmer-text" : "";
  const [note, setNote] = useState<string | null>(null);
  const votes = members.filter((m) => m.vote_plan_id === plan.id).length;

  function text() {
    return [
      `${group.name}: ${plan.title}`,
      ...plan.items.map((it) => {
        const s = localStart(it.start_time, lang);
        return `${s.day ? `${s.day} ` : ""}${s.time}: ${it.name}`;
      }),
      t("final.shareAbout", { price: usd(plan.per_person_cents) }),
    ].join("\n");
  }
  async function share() {
    const body = text();
    if (navigator.share) {
      try {
        await navigator.share({ title: plan.title, text: body });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(body);
      setNote(t("final.copied"));
    } catch {
      setNote(t("final.shareFailed"));
    }
    setTimeout(() => setNote(null), 2000);
  }

  return (
    <section className="mx-auto w-fit max-w-full">
      <div className="grid items-stretch gap-8 lg:grid-cols-[28rem_20rem] lg:gap-12">
        <div className="flex min-h-0 min-w-0 flex-col">
          <Recap
            plan={plan}
            url={plan.recap_image_url ?? group.recap_image_url}
            painting={painting}
            className="aspect-[16/10] lg:aspect-auto lg:min-h-full lg:flex-1"
          />
          <p className="mt-2 text-[11px] text-navy/65">{t("final.posterCredit")}</p>
        </div>

        <div className="w-full max-w-xs lg:w-80 lg:max-w-none">
          <p className="text-sm font-semibold text-navy/70">{t("final.yourPlan")}</p>
          <h2 className={`font-logo mt-2 text-3xl leading-[1.1] font-bold tracking-tight text-navy ${pending ? "motion-safe:animate-pulse" : ""}`}><bdi>{plan.title}</bdi></h2>
          <p className="mt-2 text-sm text-navy/70">
            {t("final.votesLine", { votes, total: members.length, price: usd(plan.per_person_cents) })}
          </p>

          <ol className="mt-6">
            {plan.items.map((it, i) => {
              const s = localStart(it.start_time, lang);
              const c = catalogEntry(it.catalog_id);
              const last = i === plan.items.length - 1;
              return (
                <li key={i} className="flex gap-3">
                  <div className="w-16 shrink-0 pt-0.5 text-end">
                    {s.day && <div className="text-[11px] font-semibold uppercase tracking-wider text-spring-deep">{s.day}</div>}
                    <div className="text-sm font-bold leading-tight tabular-nums text-navy">{s.time}</div>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="mt-1 h-3 w-3 rounded-sm bg-sun" />
                    {!last && <span className="w-px flex-1 bg-navy/15" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-5">
                    <p className="font-semibold text-navy"><bdi>{it.name}</bdi></p>
                    {c && <p className="text-xs text-navy/70">{c.neighborhood}{c.duration_minutes ? t("final.aboutMinutes", { minutes: c.duration_minutes }) : ""}</p>}
                    {it.note && <p className={`text-xs text-navy/70 ${shimmer}`}><bdi>{it.note}</bdi></p>}
                    {transitNotes[i] && <p className={`mt-0.5 text-xs text-navy/65 ${shimmer}`}>🚇 {transitNotes[i]}</p>}
                  </div>
                </li>
              );
            })}
          </ol>

          {plan.why_it_works && (
            <GrokSays label={t("plan.whyItFits")} className="mt-1">
              <bdi className={shimmer}>{plan.why_it_works}</bdi>
            </GrokSays>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <button onClick={() => downloadIcs(plan, group.name)} className="q-btn q-btn-primary">
              {t("final.addToCalendar")}
            </button>
            <button onClick={share} className="q-btn q-btn-secondary">
              {t("final.share")}
            </button>
          </div>
          {note && <p className="mt-3 text-sm font-medium text-emerald-700">{note}</p>}
          <p className="mt-3 text-xs text-navy/65">{t("final.pricesNote")}</p>
        </div>
      </div>
    </section>
  );
}
