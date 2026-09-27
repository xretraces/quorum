// Photos of a plan's stops. Which image each stop shows is decided by lib/venuePhotos (real photo of the place > free
// stock photo > Grok Imagine as a logged last resort); if an image fails to load, the next one in that order takes over.
// Images live in public/venues/ (see `photos` / `stock_photos` in data/atlanta-activities.json). With no image at all a
// stop gets a gradient + category icon. Two layouts share that logic and the credit line:
// - VenuePhotos (voting cards): the first stop big, the other stops as small thumbnails.
// - FinalPhotos (final "Your plan" screen): the first stop as a hero, the other stops captioned below it.
// Live Grok Imagine generation is never automatic: the final screen offers it as an optional "Make a Grok poster" button.
import { type ReactNode, useState } from "react";
import { useT } from "../i18n/hooks";
import type { PlanItem } from "../lib/supabase";
import { pickImage, venueCategory, type VenueImage } from "../lib/venuePhotos";

const ICON: Record<string, string> = { food: "🍽️", activity: "🎯", outdoors: "🌳", attraction: "🎟️", museum: "🏛️", entertainment: "🎭" };
const GRADIENTS = ["from-navy via-spring-deep to-spring", "from-amber-500 via-amber-400 to-sun", "from-emerald-500 via-teal-500 to-spring-deep"];
const short = (name: string) => name.replace(/\s*\(.*\)$/, "");

type PhotoProps = { item: PlanItem; img: VenueImage | null; i: number; className: string; onFail: (src: string) => void; eager?: boolean };

function Photo({ item, img, i, className, onFail, eager }: PhotoProps) {
  const t = useT();
  if (img) {
    const alt = img.kind === "ai" ? t("photos.aiAlt", { name: short(item.name) }) : short(item.name);
    return (
      <img
        key={img.src}
        src={img.src}
        alt={alt}
        data-photo-kind={img.kind}
        data-catalog-id={item.catalog_id}
        loading={eager ? "eager" : "lazy"}
        onError={() => onFail(img.src)}
        className={`object-cover ${className}`}
      />
    );
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

/** The image each stop shows right now (a failed load moves that stop to its next candidate) and the credit line parts. */
function useStopImages(items: PlanItem[]) {
  const t = useT();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const onFail = (src: string) => setFailed((f) => new Set(f).add(src));
  const shown = items.map((it) => pickImage(it.catalog_id, failed));
  const credits = shown.filter((c, k, all): c is VenueImage => !!c && all.findIndex((d) => d?.src === c.src) === k);
  const real = credits.filter((c) => c.kind === "real");
  const stock = credits.filter((c) => c.kind === "stock");
  const ai = credits.some((c) => c.kind === "ai");
  const parts = [
    real.length > 0 && <Credits key="real" list={real} label={real.length === 1 ? t("photos.photo") : t("photos.photos")} />,
    stock.length > 0 && <Credits key="stock" list={stock} label={t("photos.stock")} />,
    ai && <span key="ai">{t("photos.byGrokImagine")}</span>,
  ].filter(Boolean) as ReactNode[];
  return { shown, onFail, parts };
}

function CreditLine({ parts, className }: { parts: ReactNode[]; className: string }) {
  if (parts.length === 0) return null;
  return (
    <p data-testid="photo-credits" className={`mt-1 px-1 leading-snug ${className}`}>
      {parts.map((p, k) => (
        <span key={k}>
          {k > 0 && " · "}
          {p}
        </span>
      ))}
    </p>
  );
}

export function VenuePhotos({ items }: { items: PlanItem[] }) {
  const { shown, onFail, parts } = useStopImages(items);
  if (items.length === 0) return null;
  const [first, ...rest] = items;

  return (
    <div>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-spring/20 text-4xl">
        <Photo item={first} img={shown[0]} i={0} className="h-full w-full" onFail={onFail} />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-navy/75 to-transparent p-2 pt-8">
          <span dir="auto" className="min-w-0 truncate text-sm font-semibold text-white drop-shadow">📍 {short(first.name)}</span>
          {rest.length > 0 && (
            <div className="flex shrink-0 gap-1.5 text-base">
              {rest.slice(0, 3).map((it, k) => (
                <div key={k} className="h-12 w-12 overflow-hidden rounded-md border-2 border-white" title={short(it.name)}>
                  <Photo item={it} img={shown[k + 1]} i={k + 1} className="h-full w-full" onFail={onFail} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <CreditLine parts={parts} className="text-[10px] text-navy/70" />
    </div>
  );
}

/** The winning plan's real places on the final screen: first stop as the hero, the other stops captioned below it. */
export function FinalPhotos({ items }: { items: PlanItem[] }) {
  const t = useT();
  const { shown, onFail, parts } = useStopImages(items);
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  const caption = "absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy/80 via-navy/35 to-transparent text-start";

  return (
    <div data-testid="final-photos">
      <figure data-testid="final-hero" className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-spring/20 text-5xl sm:aspect-[16/10]">
        <Photo item={first} img={shown[0]} i={0} className="h-full w-full" onFail={onFail} eager />
        <figcaption className={`${caption} p-3 pt-12`}>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-white/80">{t("final.stopN", { n: 1 })}</span>
          <span className="flex min-w-0 items-baseline gap-1 text-lg font-bold leading-tight text-white drop-shadow">
            <span aria-hidden>📍</span>
            <bdi className="min-w-0 truncate">{short(first.name)}</bdi>
          </span>
        </figcaption>
      </figure>
      {rest.length > 0 && (
        <div data-testid="final-strip" className="mt-2 grid grid-cols-2 gap-2">
          {rest.map((it, k) => (
            <figure
              key={k}
              className={`relative overflow-hidden rounded-lg bg-spring/20 text-3xl ${
                rest.length % 2 === 1 && k === rest.length - 1 ? "col-span-full aspect-[16/7]" : "aspect-[4/3]"
              }`}
            >
              <Photo item={it} img={shown[k + 1]} i={k + 1} className="h-full w-full" onFail={onFail} eager />
              <figcaption className={`${caption} p-2 pt-8`}>
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-white/80">{t("final.stopN", { n: k + 2 })}</span>
                <bdi className="block truncate text-sm font-semibold leading-tight text-white drop-shadow rtl:text-right">{short(it.name)}</bdi>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <CreditLine parts={parts} className="text-[11px] text-navy/70" />
    </div>
  );
}
