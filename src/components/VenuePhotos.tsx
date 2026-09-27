// Photos of a plan's stops on the voting cards: the first stop big, the other stops as small thumbnails, and a tiny
// credit line. Which image each stop shows is decided by lib/venuePhotos (real photo of the place > free stock photo >
// Grok Imagine as a logged last resort); if an image fails to load, the next one in that order takes over. Images live in
// public/venues/ (see `photos` / `stock_photos` in data/atlanta-activities.json). With no image at all a stop gets a
// gradient + category icon. Live Grok Imagine generation is only used for the winning plan's poster (Recap, final screen).
import { useState } from "react";
import { useT } from "../i18n/hooks";
import type { PlanItem } from "../lib/supabase";
import { pickImage, venueCategory, type VenueImage } from "../lib/venuePhotos";

const ICON: Record<string, string> = { food: "🍽️", activity: "🎯", outdoors: "🌳", attraction: "🎟️", museum: "🏛️", entertainment: "🎭" };
const GRADIENTS = ["from-indigo-500 via-purple-500 to-pink-500", "from-amber-400 via-orange-500 to-rose-500", "from-emerald-400 via-teal-500 to-sky-600"];
const short = (name: string) => name.replace(/\s*\(.*\)$/, "");

function Photo({ item, img, i, className, onFail }: { item: PlanItem; img: VenueImage | null; i: number; className: string; onFail: (src: string) => void }) {
  const t = useT();
  if (img) {
    const alt = img.kind === "ai" ? t("photos.aiAlt", { name: short(item.name) }) : short(item.name);
    return <img key={img.src} src={img.src} alt={alt} data-photo-kind={img.kind} loading="lazy" onError={() => onFail(img.src)} className={`object-cover ${className}`} />;
  }
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br text-white ${GRADIENTS[i % GRADIENTS.length]} ${className}`}>
      <span aria-hidden className="text-[2em] drop-shadow">{ICON[venueCategory(item.catalog_id) ?? ""] ?? "📍"}</span>
    </div>
  );
}

function Credits({ list, label }: { list: VenueImage[]; label: string }) {
  const t = useT();
  return (
    <>
      {label}:{" "}
      {list.map((c, k) => (
        <span key={c.source}>
          {k > 0 && ", "}
          <a href={c.source} target="_blank" rel="noopener noreferrer" className="hover:underline">{c.author} / {c.license}</a>
        </span>
      ))}{" "}
      {t("photos.via")} {[...new Set(list.map((c) => c.site))].join(" & ")}
    </>
  );
}

export function VenuePhotos({ items }: { items: PlanItem[] }) {
  const t = useT();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) return null;
  const onFail = (src: string) => setFailed((f) => new Set(f).add(src));
  const shown = items.map((it) => pickImage(it.catalog_id, failed));
  const [first, ...rest] = items;
  const credits = shown.filter((c, k, all): c is VenueImage => !!c && all.findIndex((d) => d?.src === c.src) === k);
  const real = credits.filter((c) => c.kind === "real");
  const stock = credits.filter((c) => c.kind === "stock");
  const ai = credits.some((c) => c.kind === "ai");
  const parts = [
    real.length > 0 && <Credits key="real" list={real} label={real.length === 1 ? t("photos.photo") : t("photos.photos")} />,
    stock.length > 0 && <Credits key="stock" list={stock} label={t("photos.stock")} />,
    ai && <span key="ai">{t("photos.byGrokImagine")}</span>,
  ].filter(Boolean);

  return (
    <div>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-gray-100 text-4xl">
        <Photo item={first} img={shown[0]} i={0} className="h-full w-full" onFail={onFail} />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-2 pt-8">
          <span dir="auto" className="min-w-0 truncate text-sm font-semibold text-white drop-shadow">📍 {short(first.name)}</span>
          {rest.length > 0 && (
            <div className="flex shrink-0 gap-1.5 text-base">
              {rest.slice(0, 3).map((it, k) => (
                <div key={k} className="h-12 w-12 overflow-hidden rounded-lg ring-2 ring-white" title={short(it.name)}>
                  <Photo item={it} img={shown[k + 1]} i={k + 1} className="h-full w-full" onFail={onFail} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {parts.length > 0 && (
        <p data-testid="photo-credits" className="mt-1 px-1 text-[10px] leading-snug text-gray-400">
          {parts.map((p, k) => (
            <span key={k}>
              {k > 0 && " · "}
              {p}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
