// Private questionnaire (plain version; the polished UI is owned by a teammate). One state object with the
// exact Preferences shape. Voice input can fill fields later through the ref: `ref.current.applyPreferences(partial)`
// merges only the fields it gets (see mergePrefs) and never wipes typed ones. `mic` renders in the empty slot
// at the top. Answers are saved privately (lib/prefs.ts); the group only sees a "ready" checkmark.
import { type ReactNode, type Ref, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { EMPTY_PREFS, loadMyPrefs, mergePrefs, type Preferences, saveMyPrefs } from "../lib/prefs";

export type QuestionnaireHandle = {
  applyPreferences: (partial: Partial<Preferences>) => void;
  getPreferences: () => Preferences;
};

type Props = {
  memberId: string;
  mic?: ReactNode;
  onSaved?: () => void;
  ref?: Ref<QuestionnaireHandle>;
};

const input = "mt-1 w-full rounded-lg border border-gray-300 p-3 text-base focus:border-transparent focus:ring-2 focus:ring-indigo-500";
const label = "block text-sm font-medium text-gray-800";

export function Questionnaire({ memberId, mic, onSaved, ref }: Props) {
  const [prefs, setPrefs] = useState<Preferences>(EMPTY_PREFS);
  const [budgetText, setBudgetText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyPreferences = useCallback((partial: Partial<Preferences>) => {
    setPrefs((p) => mergePrefs(p, partial));
    if (typeof partial.budget === "number") setBudgetText(String(partial.budget));
  }, []);

  useImperativeHandle(ref, () => ({ applyPreferences, getPreferences: () => prefs }), [applyPreferences, prefs]);

  useEffect(() => {
    loadMyPrefs(memberId)
      .then((saved) => saved && applyPreferences(saved))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [memberId, applyPreferences]);

  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const b = budgetText.trim() === "" ? null : Number(budgetText.replace(/[$,\s]/g, ""));
    if (b !== null && (!Number.isFinite(b) || b < 0)) return setErr("Budget must be a dollar amount, like 30.");
    setBusy(true);
    setErr(null);
    try {
      const next = { ...prefs, budget: b === null ? null : Math.round(b) };
      setPrefs(next);
      await saveMyPrefs(memberId, next);
      onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {mic && <div>{mic}</div>}
      <p className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">🔒 Only Grok sees this. Your group just sees that you're ready.</p>

      <label className={label}>
        Budget (max $ per person)
        <input
          className={input}
          inputMode="decimal"
          placeholder="30"
          value={budgetText}
          onChange={(e) => setBudgetText(e.target.value)}
        />
      </label>

      <label className={label}>
        Food (diet, allergies, cravings)
        <input className={input} placeholder="Vegetarian, no peanuts, craving tacos" value={prefs.food} onChange={(e) => set("food", e.target.value)} />
      </label>

      <label className={label}>
        Getting there
        <select
          className={input}
          value={prefs.transport ?? ""}
          onChange={(e) => set("transport", (e.target.value || null) as Preferences["transport"])}
        >
          <option value="">Choose…</option>
          <option value="car">Car</option>
          <option value="marta">MARTA</option>
          <option value="rideshare">Rideshare</option>
          <option value="walk">Walking</option>
        </select>
      </label>

      <fieldset>
        <legend className={label}>When you're free</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-600">
            From
            <input type="time" className={input} value={prefs.freeFrom ?? ""} onChange={(e) => set("freeFrom", e.target.value || null)} />
          </label>
          <label className="text-xs text-gray-600">
            Until
            <input type="time" className={input} value={prefs.freeUntil ?? ""} onChange={(e) => set("freeUntil", e.target.value || null)} />
          </label>
        </div>
      </fieldset>

      <label className={label}>
        Hard no's (things that would make you skip a plan)
        <input className={input} placeholder="No heights, no museums" value={prefs.hardNos} onChange={(e) => set("hardNos", e.target.value)} />
      </label>

      <label className={label}>
        Other (anything else Grok should know)
        <textarea className={`${input} h-20 resize-none`} value={prefs.other} onChange={(e) => set("other", e.target.value)} />
      </label>

      <button disabled={busy} className="w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "Saving…" : "I'm ready"}
      </button>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
    </form>
  );
}
