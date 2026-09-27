// "Grok is working" card shown to every member while make-plan runs (up to about a minute). Steps advance on a timer from
// the shared start time; when the response arrives the remaining steps tick off quickly, then onDone hides it.
import { useEffect, useRef, useState } from "react";
import { useT, useTNodes } from "../i18n/hooks";
import type { GrokRun } from "../lib/grokRun";
import { DemoPlanPill, GrokAvatar, GrokSays } from "./Grok";

// i18n keys (src/i18n/en.json): the step list and Grok's matching "is doing X…" line.
const STEPS = ["working.step0", "working.step1", "working.step2", "working.step3", "working.step4"];
const SAYS = ["working.says0", "working.says1", "working.says2", "working.says3", "working.says4"];
/** Seconds after the start at which each step becomes active. The last one stays active until the response. */
const STEP_AT_S = [0, 5, 14, 26, 40];
const FINISH_STEP_MS = 220;
const FINISH_HOLD_MS = 1400;
const SLOW_AFTER_S = 75;

const startedSteps = (elapsedS: number) => STEP_AT_S.filter((t) => elapsedS >= t).length;

export function GrokWorking({ run, isMine, onDone }: { run: GrokRun; isMine: boolean; onDone: () => void }) {
  const t = useT();
  const tNodes = useTNodes();
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLElement>(null);
  const finished = run.finishedAt !== null;

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), finished ? 80 : 250);
    return () => clearInterval(t);
  }, [finished]);

  const elapsedS = Math.max(0, ((run.finishedAt ?? now) - run.startedAt) / 1000);
  const doneBeforeFinish = Math.max(0, startedSteps(elapsedS) - 1);
  const finishMs = finished ? Math.max(0, now - run.finishedAt!) : 0;
  const doneCount = finished
    ? Math.min(STEPS.length, doneBeforeFinish + 1 + Math.floor(finishMs / FINISH_STEP_MS))
    : doneBeforeFinish;
  const allDone = doneCount === STEPS.length;
  const hideAt = (STEPS.length - doneBeforeFinish) * FINISH_STEP_MS + FINISH_HOLD_MS;

  useEffect(() => {
    if (finished && finishMs >= hideAt) onDone();
  }, [finished, finishMs, hideAt, onDone]);

  useEffect(() => {
    if (allDone) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [allDone]);

  const clockS = Math.floor(elapsedS);
  const clock = `${Math.floor(clockS / 60)}:${String(clockS % 60).padStart(2, "0")}`;
  const demo = run.outcome === "demo" || run.outcome === "backup";
  const backup = run.outcome === "backup";

  return (
    <section ref={ref} aria-live="polite" className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 shadow-md">
      <div className="flex items-center gap-2.5">
        <GrokAvatar size={32} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-bold text-gray-900">Grok</p>
          <p className="text-xs text-gray-500">{t("working.subtitle")}</p>
        </div>
        <span className="font-mono text-xs tabular-nums text-indigo-400">{clock}</span>
      </div>

      <p className="text-lg text-gray-900">
        {allDone ? (
          <span className="font-semibold">{t(demo ? (backup ? "working.readyBackup" : "working.readyDemo") : "working.readyGrok")}</span>
        ) : (
          <span key={doneCount} className="shimmer-text">
            {tNodes(SAYS[Math.min(doneCount, SAYS.length - 1)], { grok: <b>Grok</b> })}
          </span>
        )}
      </p>
      {!isMine && !allDone && <p className="-mt-2 text-xs text-gray-500">{t("working.askedBy", { name: run.by })}</p>}

      <ol className="space-y-2.5">
        {STEPS.map((label, i) => {
          const state = i < doneCount ? "done" : i === doneCount && !allDone ? "active" : "todo";
          return (
            <li key={label} className="flex items-center gap-3">
              {state === "done" ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white motion-safe:animate-pop">
                  ✓
                </span>
              ) : state === "active" ? (
                <span className="h-6 w-6 shrink-0 rounded-full border-[3px] border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
              ) : (
                <span className="h-6 w-6 shrink-0 rounded-full border-2 border-gray-200 bg-white" />
              )}
              <span
                className={`text-sm transition-colors ${
                  state === "done" ? "text-gray-700" : state === "active" ? "font-semibold text-indigo-700" : "text-gray-400"
                }`}
              >
                {t(label)}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
          style={{ width: `${Math.max(6, (doneCount / STEPS.length) * 100)}%` }}
        />
      </div>

      {!allDone && (
        <p className="text-xs text-gray-500">
          {elapsedS > SLOW_AFTER_S
            ? t("working.slow")
            : t("working.usual")}
        </p>
      )}
      {allDone && (
        <GrokSays tag={demo && <DemoPlanPill backup={backup} />}>
          {backup
            ? t("working.doneBackup")
            : demo
              ? t("working.doneDemo")
              : t("working.doneGrok")}
        </GrokSays>
      )}
    </section>
  );
}
