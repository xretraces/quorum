// src/lib/parsePrefs.ts: spoken transcript -> questionnaire fields, via the parse-prefs Edge Function.
import type { Preferences } from "../../supabase/functions/_shared/preferences.ts";
import { invoke } from "./supabase";

export type { Preferences };

// invoke()'s name union doesn't list parse-prefs yet (supabase.ts is being rebuilt on another branch).
const invokeFn = invoke as <T>(fn: string, body: unknown) => Promise<T>;

/** Returns only the fields the person mentioned. Throws InvokeError on 400 (empty transcript) or network failure. */
export async function parsePrefs(transcript: string, current?: Partial<Preferences>): Promise<Partial<Preferences>> {
  const res = await invokeFn<{ preferences: Partial<Preferences>; heard: string }>("parse-prefs", { transcript, current });
  return res.preferences;
}
