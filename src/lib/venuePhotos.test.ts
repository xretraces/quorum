import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { CATALOG_FILE } from "../../supabase/functions/_shared/catalog.ts";
import { imageCandidates, pickImage, rankImages, type VenueImage } from "./venuePhotos.ts";

const img = (kind: VenueImage["kind"], src: string): VenueImage => ({ kind, src, author: "a", license: "l", source: "s", site: "x" });
const ids = (CATALOG_FILE.activities as unknown as { id: string }[]).map((a) => a.id);

test("real beats stock beats AI, whatever order the data lists them in", () => {
  const out = rankImages([img("ai", "/ai.jpg"), img("stock", "/own-stock.jpg"), img("real", "/real.jpg")], img("stock", "/cat.jpg"));
  assert.deepEqual(out.map((p) => p.src), ["/real.jpg", "/own-stock.jpg", "/cat.jpg", "/ai.jpg"]);
});

test("category stock comes before an AI picture", () => {
  assert.deepEqual(rankImages([img("ai", "/ai.jpg")], img("stock", "/cat.jpg")).map((p) => p.kind), ["stock", "ai"]);
});

test("a failed image falls through to the next kind", () => {
  const first = pickImage(ids[0]!);
  assert.equal(first?.kind, "real");
  assert.equal(pickImage(ids[0]!, new Set([first!.src]))?.kind, "stock");
});

test("every catalog venue shows a real photo of the place, with a credit and a file on disk", () => {
  for (const id of ids) {
    const p = pickImage(id);
    assert.equal(p?.kind, "real", `${id} should have a real photo`);
    assert.ok(p!.author && p!.license && p!.source && p!.site, `${id} credit incomplete`);
    assert.ok(existsSync(new URL(`../../public${p!.src}`, import.meta.url)), `${id}: missing public${p!.src}`);
  }
});

test("no catalog venue carries a Grok Imagine picture; every category has a stock backup on disk", () => {
  for (const id of ids) assert.ok(!imageCandidates(id).some((p) => p.kind === "ai"), `${id} has an AI image`);
  const cats = new Set((CATALOG_FILE.activities as unknown as { category: string }[]).map((a) => a.category));
  for (const c of cats) {
    const s = (CATALOG_FILE.stock_photos as unknown as Record<string, VenueImage>)[c];
    assert.ok(s && s.kind === "stock" && existsSync(new URL(`../../public${s.src}`, import.meta.url)), `no stock photo for ${c}`);
  }
});

test("an unknown id still gets the stock photo for its category", () => {
  assert.equal(imageCandidates("not-in-catalog", "food")[0]?.kind, "stock");
  assert.equal(imageCandidates("not-in-catalog").length, 0);
});
