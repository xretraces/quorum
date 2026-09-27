import { createContext, type ReactNode } from "react";
import type { Lang } from "./languages";

export type Vars = Record<string, string | number>;
export type TFunction = (key: string, vars?: Vars) => string;
/** Like t(), but placeholders may be React nodes (e.g. `{grok}` -> <b>Grok</b>). */
export type TNodesFunction = (key: string, vars?: Record<string, ReactNode>) => ReactNode[];

export type LanguageContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  dir: "ltr" | "rtl";
  t: TFunction;
  tNodes: TNodesFunction;
};

export const LanguageContext = createContext<LanguageContextValue | null>(null);
