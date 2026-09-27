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
    <article className={`space-y-4 ${isMyVote ? "border-s-4 border-sun ps-4" : ""}`}>
      <VenuePhotos items={plan.items} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {labels.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {labels.map((l) => (
                <span key={l} className="text-xs font-bold tracking-wide text-emerald-700 uppercase">{l}</span>
              ))}
            </div>
          )}
          <h3 className={`q-h2 text-2xl leading-tight ${shimmer}`}><bdi>{plan.title}</bdi></h3>
        </div>
        <div className="shrink-0 text-end">
          <div className="font-logo text-2xl leading-none font-bold tracking-tight text-navy">{usd(plan.per_person_cents)}</div>
          <div className="mt-1 text-[11px] font-medium text-navy/50">{t("plan.perPerson")}</div>
        </div>
      </div>

      <ol className="space-y-2">
        {plan.items.map((it, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="w-[4.5rem] shrink-0 font-semibold tabular-nums text-navy/55">{localStart(it.start_time, lang).time}</span>
            <span className="min-w-0">
              <bdi className="font-semibold text-navy">{it.name}</bdi>
              {it.note && <bdi className={`block text-xs text-navy/60 ${shimmer}`}>{it.note}</bdi>}
            </span>
          </li>
        ))}
      </ol>

      {plan.why_it_works && (
        <GrokSays label={t("plan.whyItFits")} tag={notGrok && <DemoPlanPill backup={plan.model === "backup"} />}>
          <bdi className={shimmer}>{plan.why_it_works}</bdi>
        </GrokSays>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={!canVote || busy}
          onClick={onVote}
          className={`q-btn ${isMyVote ? "q-btn-dark" : "q-btn-primary"}`}
        >
          {isMyVote ? t("plan.imInChecked") : t("plan.imIn")}
        </button>
        <span className="text-sm font-bold tabular-nums text-navy/70">
          {voters.length}/{memberCount}
        </span>
      </div>
      {voters.length > 0 && <p className="text-xs text-navy/60">{tNodes("plan.votersIn", { names: isoList(voters.map((v) => v.display_name), t("common.listSep")) })}</p>}
      {onPick && (
        <button
          disabled={busy}
          onClick={onPick}
          className="q-btn q-btn-secondary min-h-11 text-sm"
        >
          {t("plan.pickTie")}
        </button>
      )}
    </article>
  );
}
