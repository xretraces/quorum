// Grok's look in the UI: a square navy tile with Grok's sparkle (Jocelyn's spring/navy/sun palette) and an attributed
// "Grok" line, so AI messages look different from people's. The in-app AI is always named Grok; Quorum is the app.
import type { ReactNode } from "react";
import { useT } from "../i18n/hooks";

/** Quorum's own "q" mark (same glyph as the favicon). */
export function QuorumMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-[6px] bg-navy ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.72} height={size * 0.72}>
        <circle cx="14.2" cy="13.6" r="5.6" fill="none" stroke="#ffd000" strokeWidth="3.6" />
        <rect x="17.5" y="8.6" width="3.6" height="16.2" rx="1" fill="#ffd000" />
      </svg>
    </span>
  );
}

/** Grok's avatar: sun-yellow sparkle on a navy tile. */
export function GrokAvatar({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-[6px] bg-navy text-sun ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="#ffd000">
        <path d="M12 2c.6 4.9 2.9 7.3 8 8-5.1.7-7.4 3.1-8 8-.6-4.9-2.9-7.3-8-8 5.1-.7 7.4-3.1 8-8Z" />
        <path d="M19 15.5c.25 1.9 1.1 2.8 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.2 2.75-1.1 3-3Z" opacity=".7" />
      </svg>
    </span>
  );
}

/** Tag on plans Grok didn't write: "backup" = make-plan's catalog picks from everyone's answers; else saved demo plans. */
export function DemoPlanPill({ backup = false }: { backup?: boolean }) {
  const t = useT();
  return (
    <span title={t(backup ? "pill.backupTitle" : "pill.demoTitle")} className="q-tag border border-navy/20 bg-white text-navy/70">
      {t(backup ? "pill.backup" : "pill.demo")}
    </span>
  );
}

/** One of Grok's lines: avatar, a "Grok" label (plus optional context/tag), then the text. */
export function GrokSays({ label, tag, children, className = "" }: { label?: string; tag?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`flex gap-2.5 ${className}`}>
      <GrokAvatar size={22} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-[22px]">
          <b className="font-logo font-bold text-navy">Grok</b>
          {label && <span className="text-navy/70">{label}</span>}
          {tag}
        </p>
        <div className="text-sm text-navy/85">{children}</div>
      </div>
    </div>
  );
}
