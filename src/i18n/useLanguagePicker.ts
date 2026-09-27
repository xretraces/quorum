// Everything a language button needs, independent of how it looks. The built-in LanguageSwitcher uses it, and any
// other control (e.g. an "EN" button in a header) can too:
//   const { shortCode, languages, lang, choose, cycle, label } = useLanguagePicker();
//   <LanguageMenu className="relative ..."><span>{shortCode}</span></LanguageMenu>   // native list, see LanguageSwitcher.tsx
//   <button onClick={cycle}>{shortCode}</button>                                      // or step through languages
import { useCallback } from "react";
import { useLanguage, useT } from "./hooks";
import { isLang, type Lang, LANGUAGES } from "./languages";

export function useLanguagePicker() {
  const { lang, setLang, dir } = useLanguage();
  const t = useT();
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  /** Pick a language by code; unknown codes are ignored. The choice is saved (localStorage) and applied everywhere. */
  const choose = useCallback((code: string) => {
    if (isLang(code)) setLang(code);
  }, [setLang]);
  /** Next language in the list (wraps around). */
  const cycle = useCallback(() => {
    const i = LANGUAGES.findIndex((l) => l.code === lang);
    setLang(LANGUAGES[(i + 1) % LANGUAGES.length].code as Lang);
  }, [lang, setLang]);
  return {
    lang,
    dir,
    /** { code, label (native name), dir } of the active language. */
    current,
    /** All supported languages, with native labels. */
    languages: LANGUAGES,
    /** "EN", "ES", "AR", … */
    shortCode: lang.toUpperCase(),
    /** Accessible name for the control, in the active language. */
    label: t("lang.label"),
    choose,
    cycle,
  };
}
