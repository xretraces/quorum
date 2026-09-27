// "Your plan": the winning plan, shown live on every member's phone once the vote is decided. Real photos of the actual
// places (same stored, credited photos and fallback order as the plan cards), itinerary, Add to calendar (.ics) and Share.
// A Grok Imagine poster is optional: members can ask for one with "Make a Grok poster"; one already made is shown.
import { useState } from "react";
import { catalogEntry } from "../lib/booking";
import { localStart } from "../i18n/format";
import { useLanguage, useT } from "../i18n/hooks";
import { usePlanTranslation } from "../i18n/usePlanTranslation";
import { downloadIcs } from "../lib/calendar";
import { type Group, type Member, type Plan, usd } from "../lib/supabase";
import { GrokSays } from "./Grok";
import { Recap } from "./Recap";
import { FinalPhotos } from "./VenuePhotos";

type Props = {
  group: Group;
  plan: Plan;
  members: Member[];
  /** A Grok Imagine poster is being made right now (from this phone). */
  painting: boolean;
  /** Ask Grok Imagine for a poster (members only; undefined hides the button). */
  onMakePoster?: () => void;
  posterFailed?: boolean;
};

export function FinalPlan({ group, plan: original, members, painting, onMakePoster, posterFailed }: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const { plan, transitNotes, pending } = usePlanTranslation(original);
  const shimmer = pending ? "shimmer-text" : "";
  const [note, setNote] = useState<string | null>(null);
  const votes = members.filter((m) => m.vote_plan_id === plan.id).length;
  const posterUrl = original.recap_image_url ?? group.recap_image_url;
  const showPoster = !!posterUrl || painting;

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
    <section className="space-y-4">
      <div className="rounded-2xl bg-emerald-600 p-4 text-white shadow-md">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">{t("final.yourPlan")}</p>
        <h2 className={`mt-1 text-2xl font-bold leading-tight ${pending ? "motion-safe:animate-pulse" : ""}`}>{plan.title}</h2>
        <p className="mt-1 text-sm text-emerald-50">
          {t("final.votesLine", { votes, total: members.length, price: usd(plan.per_person_cents) })}
        </p>
      </div>

      <div className="rounded-2xl bg-white p-3 shadow-md">
        <FinalPhotos items={original.items} />

        <ol className="mt-4 px-1">
          {plan.items.map((it, i) => {
            const s = localStart(it.start_time, lang);
            const c = catalogEntry(it.catalog_id);
            const last = i === plan.items.length - 1;
            return (
              <li key={i} className="flex gap-3">
                <div className="w-16 shrink-0 pt-0.5 text-end">
                  {s.day && <div className="text-[11px] font-semibold uppercase text-rose-500">{s.day}</div>}
                  <div className="text-sm font-bold leading-tight text-gray-900">{s.time}</div>
                </div>
                <div className="flex flex-col items-center">
                  <span className="mt-1 h-3 w-3 rounded-full border-2 border-indigo-600 bg-white" />
                  {!last && <span className="w-0.5 flex-1 bg-indigo-100" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <p className="font-semibold text-gray-900"><bdi>{it.name}</bdi></p>
                  {c && <p className="text-xs text-gray-500">{c.neighborhood}{c.duration_minutes ? t("final.aboutMinutes", { minutes: c.duration_minutes }) : ""}</p>}
                  {it.note && <p className={`text-xs text-gray-500 ${shimmer}`}>{it.note}</p>}
                  {transitNotes[i] && <p className={`mt-0.5 text-xs text-gray-400 ${shimmer}`}>🚇 {transitNotes[i]}</p>}
                </div>
              </li>
            );
          })}
        </ol>

        {plan.why_it_works && (
          <GrokSays label={t("plan.whyItFits")} className="rounded-xl bg-indigo-50 p-3">
            <span className={shimmer}>{plan.why_it_works}</span>
          </GrokSays>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => downloadIcs(plan, group.name)} className="rounded-xl bg-gray-900 p-3 font-semibold text-white hover:bg-gray-800">
          {t("final.addToCalendar")}
        </button>
        <button onClick={share} className="rounded-xl border border-gray-300 bg-white p-3 font-semibold text-gray-800 hover:bg-gray-50">
          {t("final.share")}
        </button>
      </div>
      {note && <p className="text-center text-sm text-emerald-700">{note}</p>}

      {(showPoster || onMakePoster) && (
        <div data-testid="grok-poster" className="rounded-2xl bg-white p-3 shadow-md">
          {showPoster ? (
            <>
              <Recap plan={plan} url={posterUrl} painting={painting} />
              <p className="mt-1 px-1 text-[11px] text-gray-500">{t("final.posterCredit")}</p>
            </>
          ) : (
            <>
              <button
                onClick={onMakePoster}
                className="w-full rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                {t("final.makePoster")}
              </button>
              <p className="mt-1 px-1 text-center text-[11px] text-gray-500">{t("final.makePosterHint")}</p>
            </>
          )}
          {posterFailed && !showPoster && <p className="mt-1 px-1 text-center text-xs text-red-600">{t("final.posterFailed")}</p>}
        </div>
      )}
      <p className="text-center text-xs text-gray-400">{t("final.pricesNote")}</p>
    </section>
  );
}
