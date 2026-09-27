// Grok Imagine poster of the winning plan (recap-image, final screen only). While it's being made, or if it never arrives,
// a gradient card with the plan's stops stands in, so the flow never waits on the image.
import { Fragment, useState } from "react";
import { useLanguage, useT } from "../i18n/hooks";
import type { Plan } from "../lib/supabase";

const GRADIENTS = [
  "from-navy via-spring-deep to-spring",
  "from-amber-500 via-amber-400 to-sun",
  "from-emerald-500 via-teal-500 to-spring-deep",
];

export function Recap({ plan, url, painting, className = "" }: { plan: Plan; url: string | null | undefined; painting: boolean; className?: string }) {
  const t = useT();
  const { dir } = useLanguage();
  const [broken, setBroken] = useState<string | null>(null);
  const show = url && broken !== url;

  return (
    <div className={`relative w-full overflow-hidden rounded-lg bg-spring/20 ${className || "aspect-[16/10]"}`}>
      {show ? (
        <img
          src={url}
          alt={t("recap.alt", { title: plan.title })}
          className="h-full w-full object-cover"
          onError={() => setBroken(url)}
        />
      ) : (
        <div className={`flex h-full w-full flex-col justify-end bg-gradient-to-br p-3 text-white ${GRADIENTS[plan.option_index % GRADIENTS.length]}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-white/80">{t("recap.stops", { count: plan.items.length })}</p>
          <p className="text-lg font-bold leading-tight drop-shadow">{plan.items.map((i, k) => (
            <Fragment key={k}>
              {k > 0 && (dir === "rtl" ? " ← " : " → ")}
              <bdi>{i.name.replace(/\s*\(.*\)$/, "")}</bdi>
            </Fragment>
          ))}</p>
        </div>
      )}
      {painting && !show && (
        <span className="q-tag absolute end-2 top-2 bg-sun text-navy motion-safe:animate-pulse">
          {t("recap.painting")}
        </span>
      )}
    </div>
  );
}
