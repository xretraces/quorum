// Merge rule for "Tell Grok about yourself" (components/VoiceFill.tsx). Pure, no DOM.
import type { Preferences } from "./prefs";

/** What to hand applyPreferences: only fields Grok actually heard, with `other` appended to what's there. */
export function voiceFillPatch(current: Preferences, parsed: Partial<Preferences>): Partial<Preferences> {
  const out: Partial<Preferences> = {};
  if (typeof parsed.budget === "number" && Number.isFinite(parsed.budget)) out.budget = parsed.budget;
  for (const k of ["dietary", "availability"] as const) {
    const v = parsed[k]?.trim();
    if (v) out[k] = v;
  }
  const extra = parsed.other?.trim();
  if (extra) {
    const had = current.other.trim();
    out.other = !had ? extra : saysNothingNew(had, extra) ? had : `${had.replace(/[.;,\s]+$/, "")}. ${extra}`.slice(0, 1500); // form maxLength
  }
  return out;
}

const STOP = new Set(["i", "im", "a", "an", "the", "and", "to", "my", "me", "really", "just", "like", "so", "do", "does", "is", "am", "are", "be", "you", "they", "he", "she", "we"]);
const words = (s: string) =>
  s.toLowerCase().replace(/\b\w+n['’]t\b/g, "not").replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));

/** True if every meaningful word of `extra` is already in `had`. Grok rewords between takes ("doesn't have a car" / "I don't have a car"). */
function saysNothingNew(had: string, extra: string): boolean {
  const have = new Set(words(had));
  const add = words(extra);
  return add.length > 0 && add.every((w) => have.has(w));
}
