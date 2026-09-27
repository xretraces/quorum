// Language picker, pinned to the top corner of every screen (mirrors to the left in RTL).
// Deliberately plain and self-contained so it's easy to restyle: pass `className` to override the position/look.
// A compact globe + language code is shown; the transparent native <select> on top opens the full list
// (so a custom `className` needs a position: `fixed`, `absolute` or `relative`).
import { useLanguage, useT } from "../i18n/hooks";
import { isLang, LANGUAGES } from "../i18n/languages";

export function LanguageSwitcher({ className = "fixed top-2 end-2 z-50" }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  const t = useT();
  return (
    <div className={`flex h-9 items-center gap-1 rounded-full bg-white/90 px-2.5 text-xs font-semibold text-gray-700 shadow ring-1 ring-gray-200 ${className}`}>
      <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
      </svg>
      <span aria-hidden>{lang.toUpperCase()}</span>
      <span aria-hidden className="text-[10px] text-gray-400">▾</span>
      <select
        value={lang}
        onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}
        aria-label={t("lang.label")}
        title={t("lang.label")}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}
