// One plan option while voting: real photos of the stops (VenuePhotos), labels ("Fits everyone", "Cheapest"), estimated cost,
// stops, Grok's group-level "why it fits" (never about one person), and "I'm in" with the live vote count.
import type { Member, Plan } from "../lib/supabase";
import { usd } from "../lib/supabase";
import { localStart } from "../i18n/format";
import { isoList } from "../i18n/bidi";
import { useLanguage, useT, useTNodes } from "../i18n/hooks";
import { usePlanTranslation } from "../i18n/usePlanTranslation";
import { DemoPlanPill, GrokSays } from "./Grok";
import { VenuePhotos } from "./VenuePhotos";

type Props = {
  plan: Plan;
  labels: string[];
  voters: Member[];
  memberCount: number;
  isMyVote: boolean;
  canVote: boolean;
  busy: boolean;
  onVote: () => void;
  /** Set for the creator on a tied plan: pick it as the winner. */
  onPick?: () => void;
};

export function PlanCard({ plan: original, labels, voters, memberCount, isMyVote, canVote, busy, onVote, onPick }: Props) {
  const t = useT();
  const tNodes = useTNodes();
  const { lang } = useLanguage();
  const { plan, pending } = usePlanTranslation(original);
  const shimmer = pending ? "shimmer-text" : "";
  const notGrok = plan.model === "backup" || plan.model === "demo-fallback";
  return (
    <article className={`space-y-3 rounded-2xl bg-white p-3 shadow-md ${isMyVote ? "ring-2 ring-indigo-500" : ""}`}>
      <VenuePhotos items={plan.items} />

      <div className="flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          {labels.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {labels.map((l) => (
                <span key={l} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">{l}</span>
              ))}
            </div>
          )}
          <h3 className={`text-lg font-bold leading-tight text-gray-900 ${shimmer}`}>{plan.title}</h3>
        </div>
        <div className="shrink-0 text-end">
          <div className="text-xl font-bold text-indigo-600">{usd(plan.per_person_cents)}</div>
          <div className="text-[11px] text-gray-500">{t("plan.perPerson")}</div>
        </div>
      </div>

      <ol className="space-y-1 px-1">
        {plan.items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="w-[4.5rem] shrink-0 text-gray-500">{localStart(it.start_time, lang).time}</span>
            <span className="min-w-0">
              <bdi className="font-medium text-gray-900">{it.name}</bdi>
              {it.note && <span className={`block text-xs text-gray-500 ${shimmer}`}>{it.note}</span>}
            </span>
          </li>
        ))}
      </ol>

      {plan.why_it_works && (
        <GrokSays label={t("plan.whyItFits")} tag={notGrok && <DemoPlanPill backup={plan.model === "backup"} />} className="rounded-xl bg-indigo-50 p-3">
          <span className={shimmer}>{plan.why_it_works}</span>
        </GrokSays>
      )}

      <div className="flex items-center gap-2 px-1 pb-1">
        <button
          disabled={!canVote || busy}
          onClick={onVote}
          className={`flex-1 rounded-xl px-4 py-3 font-semibold transition-colors disabled:opacity-50 ${
            isMyVote ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
          }`}
        >
          {isMyVote ? t("plan.imInChecked") : t("plan.imIn")}
        </button>
        <span className="shrink-0 rounded-xl bg-gray-100 px-3 py-3 text-sm font-semibold tabular-nums text-gray-700">
          {voters.length}/{memberCount}
        </span>
      </div>
      {voters.length > 0 && <p className="px-1 text-xs text-gray-500">{tNodes("plan.votersIn", { names: isoList(voters.map((v) => v.display_name), t("common.listSep")) })}</p>}
      {onPick && (
        <button
          disabled={busy}
          onClick={onPick}
          className="w-full rounded-xl border-2 border-emerald-600 p-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {t("plan.pickTie")}
        </button>
      )}
    </article>
  );
}
