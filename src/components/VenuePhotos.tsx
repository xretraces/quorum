// Real photos of a plan's stops on the voting cards: the first stop big, the other stops as small thumbnails,
// and a tiny credit line. Photos are freely licensed Wikimedia Commons images served from public/venues/ (see
// data/atlanta-activities.json `photo` / `photoCredit`). A stop without a photo gets a gradient + category icon.
// Grok Imagine is only used for the winning plan's poster (Recap on the final screen).
import { useState } from "react";
import { venuePhoto } from "../lib/booking";
import type { PlanItem } from "../lib/supabase";

const ICON: Record<string, string> = { food: "🍽️", activity: "🎯", outdoors: "🌳", attraction: "🎟️", museum: "🏛️", entertainment: "🎭" };
const GRADIENTS = ["from-indigo-500 via-purple-500 to-pink-500", "from-amber-400 via-orange-500 to-rose-500", "from-emerald-400 via-teal-500 to-sky-600"];
const short = (name: string) => name.replace(/\s*\(.*\)$/, "");

function Photo({ item, i, className }: { item: PlanItem; i: number; className: string }) {
  const v = venuePhoto(item.catalog_id);
  const [broken, setBroken] = useState(false);
  if (v?.photo && !broken) {
    return <img src={v.photo} alt={short(item.name)} loading="lazy" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  }
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br text-white ${GRADIENTS[i % GRADIENTS.length]} ${className}`}>
      <span aria-hidden className="text-[2em] drop-shadow">{ICON[v?.category ?? ""] ?? "📍"}</span>
    </div>
  );
}

export function VenuePhotos({ items }: { items: PlanItem[] }) {
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  const credits = items.map((it) => venuePhoto(it.catalog_id)?.photoCredit).filter((c, k, all) => c && all.findIndex((d) => d?.source === c.source) === k);

  return (
    <div>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-gray-100 text-4xl">
        <Photo item={first} i={0} className="h-full w-full" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-2 pt-8">
          <span className="min-w-0 truncate text-sm font-semibold text-white drop-shadow">📍 {short(first.name)}</span>
          {rest.length > 0 && (
            <div className="flex shrink-0 gap-1.5 text-base">
              {rest.slice(0, 3).map((it, k) => (
                <div key={k} className="h-12 w-12 overflow-hidden rounded-lg ring-2 ring-white" title={short(it.name)}>
                  <Photo item={it} i={k + 1} className="h-full w-full" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {credits.length > 0 && (
        <p className="mt-1 px-1 text-[10px] leading-snug text-gray-400">
          {credits.length === 1 ? "Photo" : "Photos"}:{" "}
          {credits.map((c, k) => (
            <span key={c!.source}>
              {k > 0 && ", "}
              <a href={c!.source} target="_blank" rel="noopener noreferrer" className="hover:underline">{c!.author} / {c!.license}</a>
            </span>
          ))}{" "}
          via Wikimedia Commons
        </p>
      )}
    </div>
  );
}
