// Quorum's own voice in the UI: a square "q" mark (same glyph as the favicon) and an attributed "Quorum" line,
// so planner messages look different from people without borrowing chatbot visuals.
import type { ReactNode } from "react";
import { useT } from "../i18n/hooks";

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

/** Tag on plans the AI planner didn't write: "backup" = make-plan's catalog picks from everyone's answers; else saved demo plans. */
export function DemoPlanPill({ backup = false }: { backup?: boolean }) {
  const t = useT();
  return (
    <span title={t(backup ? "pill.backupTitle" : "pill.demoTitle")} className="q-tag border border-navy/20 bg-white text-navy/70">
      {t(backup ? "pill.backup" : "pill.demo")}
    </span>
  );
}

/** One of Quorum's lines: mark, a "Quorum" label (plus optional context/tag), then the text. */
export function QuorumSays({ label, tag, children, className = "" }: { label?: string; tag?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`flex gap-2.5 ${className}`}>
      <QuorumMark size={22} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-[22px]">
          <b className="font-logo font-bold text-navy">Quorum</b>
          {label && <span className="text-navy/70">{label}</span>}
          {tag}
        </p>
        <div className="text-sm text-navy/85">{children}</div>
      </div>
    </div>
  );
}
