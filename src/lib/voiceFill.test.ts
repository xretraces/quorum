import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceFillPatch } from "./voiceFill.ts";

const empty = { budget: null, dietary: "", availability: "", other: "" };

test("fills only what Grok heard", () => {
  assert.deepEqual(voiceFillPatch(empty, { budget: 40, dietary: "vegetarian", availability: "free after 6", other: "no bars" }),
    { budget: 40, dietary: "vegetarian", availability: "free after 6", other: "no bars" });
  assert.deepEqual(voiceFillPatch(empty, { dietary: "gluten free", availability: "  " }), { dietary: "gluten free" });
});

test("overwrites dietary/availability, appends other without duplicating", () => {
  const cur = { budget: 20, dietary: "vegan", availability: "Sunday", other: "No car." };
  assert.deepEqual(voiceFillPatch(cur, { dietary: "vegetarian", other: "no bars" }), { dietary: "vegetarian", other: "No car. no bars" });
  assert.deepEqual(voiceFillPatch(cur, { other: "no car" }), { other: "No car." });
});
