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
    out.other = !had ? extra : had.toLowerCase().includes(extra.toLowerCase()) ? had : `${had.replace(/[.;,\s]+$/, "")}. ${extra}`;
  }
  return out;
}
