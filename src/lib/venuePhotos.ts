// Which picture a plan stop shows. The order is fixed here, for every card, whatever order the data lists them in:
//   1. a stored REAL photo of that exact place (Wikimedia Commons / Flickr free license, or the venue's official site photo)
//   2. a stored STOCK photo (free license) — the venue's own, else the stock photo for its category
//   3. a pre-generated Grok Imagine picture — last resort only, and it is logged when it happens
// If an image fails to load, the next candidate in that order takes over. Plans can only contain catalog venues
// (make-plan pins catalog_id to the catalog ids and drops anything else), so there is no unknown-venue lookup here;
// a stop whose id is somehow unknown still gets the stock photo for its category if one is passed in.
import { CATALOG_FILE } from "../../supabase/functions/_shared/catalog.ts";

export type PhotoKind = "real" | "stock" | "ai";
export type VenueImage = { kind: PhotoKind; src: string; author: string; license: string; source: string; site: string };

export const KIND_RANK: Record<PhotoKind, number> = { real: 0, stock: 1, ai: 2 };

type Entry = { id: string; category: string; photos?: VenueImage[] };
const ENTRIES = new Map((CATALOG_FILE.activities as unknown as Entry[]).map((e) => [e.id, e]));
const STOCK = CATALOG_FILE.stock_photos as unknown as Record<string, VenueImage>;

const usable = (p: VenueImage | undefined): p is VenueImage => !!p && !!p.src && p.kind in KIND_RANK;

/** Real photos first, then stock (own, then the category's), then Grok Imagine. Stable within a kind. */
export function rankImages(own: VenueImage[], categoryStock?: VenueImage): VenueImage[] {
  const all = [...own.filter(usable), ...(usable(categoryStock) ? [categoryStock] : [])];
  const seen = new Set<string>();
  return all
    .map((p, i) => ({ p, i }))
    .sort((a, b) => KIND_RANK[a.p.kind] - KIND_RANK[b.p.kind] || a.i - b.i)
    .map(({ p }) => p)
    .filter((p) => (seen.has(p.src) ? false : (seen.add(p.src), true)));
}

/** Every image a catalog stop could show, best first. */
export function imageCandidates(catalogId: string, categoryHint?: string): VenueImage[] {
  const e = ENTRIES.get(catalogId);
  const category = e?.category ?? categoryHint;
  return rankImages(e?.photos ?? [], category ? STOCK[category] : undefined);
}

export const venueCategory = (catalogId: string) => ENTRIES.get(catalogId)?.category;

const warned = new Set<string>();
/** The image to show now: the best candidate that hasn't failed to load. Logs when it has to fall back to Grok Imagine. */
export function pickImage(catalogId: string, failed: ReadonlySet<string> = new Set()): VenueImage | null {
  const pick = imageCandidates(catalogId).find((p) => !failed.has(p.src)) ?? null;
  if (pick?.kind === "ai" && !warned.has(catalogId)) {
    warned.add(catalogId);
    console.warn(`[photos] No real or stock photo available for "${catalogId}"; falling back to a Grok Imagine picture.`);
  }
  return pick;
}
