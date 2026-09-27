// Language picker, pinned to the top corner of every screen (mirrors to the left in RTL).
// The logic lives in useLanguagePicker() (src/i18n/useLanguagePicker.ts), so another control can replace this one:
// wrap any button face in <LanguageMenu> to get the native language list, or call useLanguagePicker().cycle().
// When a header gets its own language button, drop <LanguageSwitcher /> from App.tsx.
import type { ReactNode } from "react";
import { useLanguagePicker } from "../i18n/useLanguagePicker";

/**
 * Makes its children (e.g. "EN") open the language list: a transparent native <select> sits on top, so it works with
 * the phone's own picker and a screen reader. `className` must give it a position (`relative`, `fixed`, `absolute`).
 */
export function LanguageMenu({ children, className = "relative inline-flex" }: { children: ReactNode; className?: string }) {
  const { lang, languages, choose, label } = useLanguagePicker();
  return (
    <div className={className}>
      {children}
      <select
        value={lang}
        onChange={(e) => choose(e.target.value)}
        aria-label={label}
        title={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function LanguageSwitcher({ className = "fixed top-2 end-2 z-50" }: { className?: string }) {
  const { shortCode } = useLanguagePicker();
  return (
    <LanguageMenu className={`flex h-9 items-center gap-1 rounded-full bg-white/90 px-2.5 text-xs font-semibold text-gray-700 shadow ring-1 ring-gray-200 ${className}`}>
      <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
      </svg>
      <span aria-hidden>{shortCode}</span>
      <span aria-hidden className="text-[10px] text-gray-400">▾</span>
    </LanguageMenu>
  );
}
