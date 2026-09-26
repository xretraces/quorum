// Grok as a member of the group chat: a dark avatar with a sparkle mark, and an attributed "Grok says" line
// (design-refs/chat/02 and 18: AI lines look different from people's bubbles).
import type { ReactNode } from "react";

export function GrokAvatar({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gray-900 text-white"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="currentColor">
        <path d="M12 2c.6 4.9 2.9 7.3 8 8-5.1.7-7.4 3.1-8 8-.6-4.9-2.9-7.3-8-8 5.1-.7 7.4-3.1 8-8Z" />
        <path d="M19 15.5c.25 1.9 1.1 2.8 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.2 2.75-1.1 3-3Z" opacity=".7" />
      </svg>
    </span>
  );
}

export function DemoPlanPill() {
  return (
    <span
      title="Grok didn't answer, so these are saved plans for this chat. Budgets are still checked."
      className="inline-block shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
    >
      Demo plan
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
          <b className="text-gray-900">Grok</b>
          {label && <span className="text-gray-500">{label}</span>}
          {tag}
        </p>
        <div className="text-sm text-gray-700">{children}</div>
      </div>
    </div>
  );
}
