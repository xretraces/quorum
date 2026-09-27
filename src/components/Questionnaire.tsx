// Private questionnaire: budget, dietary, availability, other. One state object with the Preferences shape.
// Voice input can fill fields later through the ref: `ref.current.applyPreferences(partial)` merges only the
// fields it gets (see mergePrefs) and never wipes typed ones. `mic` renders in the empty slot at the top.
// Answers are saved privately (lib/prefs.ts); the group only sees a "ready" checkmark.
import { type ReactNode, type Ref, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { useT } from "../i18n/hooks";
import { EMPTY_PREFS, loadMyPrefs, mergePrefs, type Preferences, saveMyPrefs } from "../lib/prefs";
import { VoiceFill } from "./VoiceFill";

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
  const t = useT();
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
    if (b !== null && (!Number.isFinite(b) || b < 0)) return setErr(t("q.budgetInvalid"));
    setBusy(true);
    setErr(null);
    try {
      const next = {
        budget: b === null ? null : Math.round(b),
        dietary: prefs.dietary.trim(),
        availability: prefs.availability.trim(),
        other: prefs.other.trim(),
      };
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
      <VoiceFill current={prefs} apply={applyPreferences} />
      {mic && <div>{mic}</div>}
      <p className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">{t("q.private")}</p>
      <p className="text-sm text-gray-500">{t("q.blankHint")}</p>

      <label className={label}>
        {t("q.budget")}
        <input
          className={input}
          inputMode="decimal"
          placeholder={t("q.noPreference")}
          value={budgetText}
          onChange={(e) => setBudgetText(e.target.value)}
        />
      </label>

      <label className={label}>
        {t("q.dietary")}
        <input className={input} placeholder={t("q.noPreference")} value={prefs.dietary} onChange={(e) => set("dietary", e.target.value)} />
      </label>

      <label className={label}>
        {t("q.availability")}
        <input className={input} placeholder={t("q.noPreference")} value={prefs.availability} onChange={(e) => set("availability", e.target.value)} />
      </label>

      <label className={label}>
        {t("q.other")}
        <textarea className={`${input} h-20 resize-none`} maxLength={1500} placeholder={t("q.noPreference")} value={prefs.other} onChange={(e) => set("other", e.target.value)} />
      </label>

      <button disabled={busy} className="w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? t("q.saving") : t("q.submit")}
      </button>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
    </form>
  );
}
