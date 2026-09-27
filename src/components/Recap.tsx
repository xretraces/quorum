// Grok Imagine picture of a plan's itinerary (recap-image). While it's being made, or if it never arrives,
// a gradient card with the plan's stops stands in, so the flow never waits on the image.
import { useState } from "react";
import type { Plan } from "../lib/supabase";

const GRADIENTS = [
  "from-indigo-500 via-purple-500 to-pink-500",
  "from-amber-400 via-orange-500 to-rose-500",
  "from-emerald-400 via-teal-500 to-sky-600",
];

export function Recap({ plan, url, painting, className = "" }: { plan: Plan; url: string | null | undefined; painting: boolean; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const show = url && broken !== url;

  return (
    <div className={`relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-gray-100 ${className}`}>
      {show ? (
        <img
          src={url}
          alt={`Grok Imagine picture of ${plan.title}`}
          className="h-full w-full object-cover"
          onError={() => setBroken(url)}
        />
      ) : (
        <div className={`flex h-full w-full flex-col justify-end bg-gradient-to-br p-3 text-white ${GRADIENTS[plan.option_index % GRADIENTS.length]}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Atlanta · {plan.items.length} stops</p>
          <p className="text-lg font-bold leading-tight drop-shadow">{plan.items.map((i) => i.name.replace(/\s*\(.*\)$/, "")).join(" → ")}</p>
        </div>
      )}
      {painting && !show && (
        <span className="absolute right-2 top-2 rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-white motion-safe:animate-pulse">
          ✨ Grok Imagine is painting…
        </span>
      )}
    </div>
  );
}
