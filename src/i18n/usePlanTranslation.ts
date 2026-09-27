// Dynamic Grok text (plan title, "why it fits", stop notes, transit tips) in the UI language. English shows
// first; the translation comes from plans.translations (cached by translate-plan, arrives via Realtime) or a
// translate-plan call. Venue names are never translated. Failures quietly keep the English text.
import { useEffect, useState } from "react";
import { catalogEntry } from "../lib/booking";
import { invoke, type Plan, type PlanTranslation } from "../lib/supabase";
import { useLanguage } from "./hooks";

const inflight = new Map<string, Promise<PlanTranslation | null>>();

function request(planId: string, lang: string) {
  const key = `${planId}:${lang}`;
  let p = inflight.get(key);
  if (!p) {
    p = invoke<{ translation: PlanTranslation }>("translate-plan", { plan_id: planId, lang })
      .then((r) => r.translation ?? null)
      .catch((e) => {
        console.warn("translate-plan failed; showing English", e);
        inflight.delete(key); // retry next time the card mounts
        return null;
      });
    inflight.set(key, p);
  }
  return p;
}

export type LocalizedPlan = {
  /** The plan with title / summary / why_it_works / item notes swapped for the translation (when there is one). */
  plan: Plan;
  /** Catalog transit tip per stop, translated when available. */
  transitNotes: (string | undefined)[];
  /** True while a translation is on its way (show the English text with a shimmer). */
  pending: boolean;
};

export function usePlanTranslation(plan: Plan): LocalizedPlan {
  const { lang } = useLanguage();
  const stored = lang === "en" ? null : plan.translations?.[lang] ?? null;
  const key = `${plan.id}:${lang}`;
  const [fetched, setFetched] = useState<{ key: string; tr: PlanTranslation | null } | null>(null);

  useEffect(() => {
    if (lang === "en" || stored) return;
    let live = true;
    request(plan.id, lang).then((tr) => live && setFetched({ key, tr }));
    return () => {
      live = false;
    };
  }, [key, lang, plan.id, stored]);

  const tr = stored ?? (fetched?.key === key ? fetched.tr : null);
  const pending = lang !== "en" && !stored && fetched?.key !== key;
  const transitNotes = plan.items.map((it, i) => tr?.items?.[i]?.transit_note || catalogEntry(it.catalog_id)?.transit_note);
  if (!tr) return { plan, transitNotes, pending };
  return {
    plan: {
      ...plan,
      title: tr.title || plan.title,
      summary: plan.summary && (tr.summary || plan.summary),
      why_it_works: plan.why_it_works && (tr.why_it_works || plan.why_it_works),
      items: plan.items.map((it, i) => ({ ...it, note: it.note && (tr.items?.[i]?.note || it.note) })),
    },
    transitNotes,
    pending,
  };
}
