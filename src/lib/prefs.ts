// Private questionnaire answers. They live in member_prefs, which no browser can query directly: this phone
// proves it owns its member with a token from claim_member (kept in localStorage) and reads/writes only its
// own answers through the save_my_prefs / get_my_prefs RPCs. Others only see members.prefs_ready.
// See supabase/migrations/20260927000001_private_prefs.sql.
import type { Preferences } from "./parsePrefs";
import { supabase } from "./supabase";

export type { Preferences };

export const EMPTY_PREFS: Preferences = {
  budget: null, dietary: "", availability: "", other: "",
};

/**
 * Fills in only the fields `partial` provides (e.g. from voice). Missing, null or blank values never wipe
 * what the person already typed.
 */
export function mergePrefs(current: Preferences, partial: Partial<Preferences>): Preferences {
  const next = { ...current };
  for (const [k, v] of Object.entries(partial) as [keyof Preferences, Preferences[keyof Preferences]][]) {
    if (!(k in EMPTY_PREFS) || v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

const TOKEN_KEY = "pp:token:";
const tokenOf = (memberId: string) => localStorage.getItem(`${TOKEN_KEY}${memberId}`);

/** Claims this member for this phone (once, right after joining) and remembers the token. */
export async function claimMember(memberId: string): Promise<string> {
  const existing = tokenOf(memberId);
  if (existing) return existing;
  const { data, error } = await supabase.rpc("claim_member", { p_member_id: memberId });
  if (error) throw new Error(`Couldn't set up your private answers: ${error.message}`);
  localStorage.setItem(`${TOKEN_KEY}${memberId}`, data as string);
  return data as string;
}

export async function loadMyPrefs(memberId: string): Promise<Preferences | null> {
  const token = await claimMember(memberId);
  const { data, error } = await supabase.rpc("get_my_prefs", { p_member_id: memberId, p_token: token });
  if (error) throw new Error(error.message);
  return data ? { ...EMPTY_PREFS, ...(data as Partial<Preferences>) } : null;
}

export async function saveMyPrefs(memberId: string, prefs: Preferences): Promise<void> {
  const token = await claimMember(memberId);
  const { error } = await supabase.rpc("save_my_prefs", { p_member_id: memberId, p_token: token, p_prefs: prefs });
  if (error) throw new Error(error.message);
}
