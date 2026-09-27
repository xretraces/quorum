// Tiny i18n layer (no library): every src/i18n/<lang>.json is bundled, so switching is instant and offline.
// Missing keys (or a language file that hasn't been generated yet) fall back to English.
// Plurals: pass `count` and add `<key>_one` / `<key>_other` entries.
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { LanguageContext, type LanguageContextValue, type Vars } from "./context";
import { dirOf, isLang, type Lang } from "./languages";

type Dict = Record<string, string>;
const files = import.meta.glob<Dict>("./*.json", { eager: true, import: "default" });
const DICTS: Partial<Record<Lang, Dict>> = {};
for (const [path, dict] of Object.entries(files)) {
  const code = path.replace(/^\.\/|\.json$/g, "");
  if (isLang(code)) DICTS[code] = dict;
}
const EN: Dict = DICTS.en ?? {};

const STORAGE_KEY = "quorum:lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* private mode */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l?.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

const PLACEHOLDER = /\{(\w+)\}/g;

const pluralForm = (lang: string, count: number) => (new Intl.PluralRules(lang).select(count) === "one" ? "one" : "other");

function lookup(lang: Lang, key: string, count: unknown): string {
  const dict = DICTS[lang] ?? {};
  if (typeof count === "number") {
    const hit = dict[`${key}_${pluralForm(lang, count)}`] ?? dict[`${key}_other`] ?? EN[`${key}_${pluralForm("en", count)}`];
    if (hit !== undefined) return hit;
  }
  return dict[key] ?? EN[key] ?? key;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = dirOf(lang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* private mode */ }
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => lookup(lang, key, vars?.count).replace(PLACEHOLDER, (m, name) => (vars && name in vars ? String(vars[name]) : m)),
    [lang],
  );

  const tNodes = useCallback(
    (key: string, vars?: Record<string, ReactNode>) =>
      lookup(lang, key, vars?.count)
        .split(/(\{\w+\})/)
        .map((part, i) => {
          const name = part.match(/^\{(\w+)\}$/)?.[1];
          return <Fragment key={i}>{name && vars && name in vars ? vars[name] : part}</Fragment>;
        }),
    [lang],
  );

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = t("meta.title");
  }, [lang, dir, t]);

  const value = useMemo<LanguageContextValue>(() => ({ lang, setLang, dir, t, tNodes }), [lang, setLang, dir, t, tNodes]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
