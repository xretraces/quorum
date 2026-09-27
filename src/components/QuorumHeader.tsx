// Shared top util nav: language (PR #15 LanguageMenu), in-app group notifications, and How-it-works info.
// Used on CreateGroup (home) and GroupBoard so every screen keeps Joc's spring/navy chrome.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { LanguageMenu } from "./LanguageSwitcher";
import { useLanguagePicker } from "../i18n/useLanguagePicker";
import { iso } from "../i18n/bidi";
import { useT, useTNodes } from "../i18n/hooks";
import { useGroupNotifications, type GroupNotification } from "../lib/useGroupNotifications";

const utilBtn =
  "inline-flex h-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

const utilBtnSolid =
  "inline-flex h-8 items-center justify-center rounded-md text-navy transition-colors hover:bg-sun focus:outline-none focus-visible:ring-2 focus-visible:ring-spring-deep/40";

function GlobeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.8 3.4 5.7 3.4 8.5s-1.1 5.7-3.4 8.5c-2.3-2.8-3.4-5.7-3.4-8.5S9.7 6.3 12 3.5z" />
    </svg>
  );
}

function BellIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 10a6 6 0 1 1 12 0c0 4.5 1.5 5.5 2.5 6.5h-17C4.5 15.5 6 14.5 6 10z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

function InfoIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

type TNodes = (k: string, v?: Record<string, ReactNode>) => ReactNode;

/** Names (and the winning plan's title) are <bdi>-isolated so they can't reorder the sentence in Arabic. */
function notifText(t: (k: string) => string, tNodes: TNodes, n: GroupNotification): ReactNode {
  const name = iso(n.name ?? "");
  switch (n.kind) {
    case "joined": return tNodes("notif.joined", { name });
    case "ready": return tNodes("notif.ready", { name });
    case "allReady": return t("notif.allReady");
    case "plansReady": return t("notif.plansReady");
    case "voted": return tNodes("notif.voted", { name });
    case "winner": return tNodes("notif.winner", { name: n.name ? name : t("notif.thePlan") });
  }
}

type Tone = "onSpring" | "onLight";

type Props = {
  /** When set, the bell listens to this group's realtime events. */
  groupId?: string | null;
  /** onSpring = white icons on Joc's blue home; onLight = navy/spring on white board. */
  tone?: Tone;
  className?: string;
  /** Show the "quorum" wordmark to the left (home). */
  showLogo?: boolean;
};

export function QuorumHeader({ groupId = null, tone = "onSpring", showLogo = false, className = "" }: Props) {
  const t = useT();
  const tNodes = useTNodes();
  const { shortCode, label: langLabel } = useLanguagePicker();
  const { items, unread, markRead, empty, isUnread } = useGroupNotifications(groupId);
  const [bellOpen, setBellOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const btn = tone === "onSpring" ? utilBtn : utilBtnSolid;
  const navCls =
    tone === "onSpring"
      ? "flex items-center gap-0.5 rounded-full border border-white/40 bg-white/15 py-1 ps-1.5 pe-1 backdrop-blur-sm"
      : "flex items-center gap-0.5 rounded-lg border-2 border-navy bg-white p-0.5";
  const divider = tone === "onSpring" ? "h-5 w-px bg-white/30" : "h-5 w-0.5 bg-navy/15";

  useEffect(() => {
    if (!bellOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBellOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [bellOpen]);

  // Events that arrive while the list is open are seen, so they shouldn't leave a badge behind after closing.
  useEffect(() => {
    if (bellOpen && unread > 0) markRead();
  }, [bellOpen, unread, markRead]);

  function openBell() {
    setBellOpen((o) => !o);
    if (!bellOpen) markRead();
  }

  return (
    <>
      {/* relative z-30: the nav's backdrop-blur makes its own stacking context, so without this the bell list
          painted under later positioned cards (e.g. the winner poster). */}
      <div className={`relative z-30 flex items-center justify-between gap-3 ${className}`}>
        {showLogo ? (
          <a
            href="/"
            className={`font-logo text-2xl font-semibold tracking-tight lowercase sm:text-3xl ${tone === "onSpring" ? "text-white" : "text-navy"}`}
          >
            quorum
          </a>
        ) : (
          <span />
        )}
        <nav className={navCls} aria-label={t("header.utilsAria")}>
          <LanguageMenu className="relative inline-flex">
            <span className={`${btn} pointer-events-none gap-1 px-2.5 text-[13px] font-semibold tracking-wide`} aria-hidden>
              <GlobeIcon />
              {shortCode}
            </span>
            <span className="sr-only">{langLabel}</span>
          </LanguageMenu>
          <span className={divider} aria-hidden />
          <div className="relative" ref={bellRef}>
            <button
              type="button"
              className={`${btn} relative w-8`}
              aria-label={t("notif.label")}
              aria-expanded={bellOpen}
              aria-haspopup="dialog"
              onClick={openBell}
            >
              <BellIcon />
              {unread > 0 && (
                <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-[4px] border border-navy bg-sun px-1 text-[10px] font-bold text-navy">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            {bellOpen && (
              <div
                role="dialog"
                aria-label={t("notif.label")}
                className="absolute end-0 top-[calc(100%+0.5rem)] z-50 w-[min(18.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-[10px] border-2 border-navy bg-white text-navy shadow-[4px_4px_0_0_var(--color-navy)]"
              >
                <div className="border-b-2 border-navy bg-sun px-3 py-2 text-xs font-bold tracking-wider text-navy uppercase">
                  {t("notif.title")}
                </div>
                {empty ? (
                  <p className="px-3 py-4 text-sm text-navy/70">
                    {groupId ? t("notif.emptyGroup") : t("notif.emptyHome")}
                  </p>
                ) : (
                  <ul className="max-h-72 overflow-y-auto py-1">
                    {items.map((n) => (
                      <li
                        key={n.key}
                        className={`border-b border-dashed border-navy/15 px-3 py-2.5 text-sm last:border-0 ${isUnread(n.key) ? "bg-spring/20 font-semibold" : ""}`}
                      >
                        <p className="leading-snug text-navy">{notifText(t, tNodes, n)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <span className={divider} aria-hidden />
          <button
            type="button"
            className={`${btn} w-8`}
            aria-label={t("info.label")}
            onClick={() => setInfoOpen(true)}
          >
            <InfoIcon />
          </button>
        </nav>
      </div>

      {infoOpen && <InfoSheet onClose={() => setInfoOpen(false)} />}
    </>
  );
}

function InfoSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="quorum-info-title">
      <button type="button" className="absolute inset-0 bg-navy/40 backdrop-blur-[2px]" aria-label={t("info.close")} onClick={onClose} />
      <div className="relative z-10 max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[14px] border-2 border-b-0 border-navy bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[12px] sm:border-b-2 sm:p-6 sm:shadow-[6px_6px_0_0_var(--color-navy)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="quorum-info-title" className="q-title text-2xl">
            {t("info.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border-2 border-navy/20 font-bold text-navy hover:border-navy hover:bg-sun"
            aria-label={t("info.close")}
          >
            ✕
          </button>
        </div>
        <ol className="space-y-3 text-sm leading-relaxed text-navy/90">
          {["info.step1", "info.step2", "info.step3", "info.step4"].map((k, i) => (
            <li key={k} className="flex gap-3">
              <span className="font-logo flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sun text-xs font-bold text-navy">{i + 1}</span>
              <span>{t(k)}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 rounded-lg border-2 border-navy bg-spring/25 p-3 text-sm leading-relaxed text-navy">
          <p className="font-bold">{t("info.privacyTitle")}</p>
          <p className="mt-1 text-navy/85">{t("info.privacyBody")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="q-btn q-btn-primary mt-5 w-full"
        >
          {t("info.gotIt")}
        </button>
      </div>
    </div>
  );
}
