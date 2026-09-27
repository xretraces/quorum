import { useContext } from "react";
import { LanguageContext } from "./context";

function useLanguageContext() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useT/useLanguage must be used inside <LanguageProvider>");
  return ctx;
}

/** `const t = useT(); t("lobby.readyCount", { ready: 2, total: 3 })` */
export const useT = () => useLanguageContext().t;
/** Placeholders can be React nodes: `tNodes("working.says0", { grok: <b>Grok</b> })`. */
export const useTNodes = () => useLanguageContext().tNodes;
/** `{ lang, setLang, dir }` */
export function useLanguage() {
  const { lang, setLang, dir } = useLanguageContext();
  return { lang, setLang, dir };
}
