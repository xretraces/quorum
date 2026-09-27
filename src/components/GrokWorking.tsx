// "Grok is working" card shown to every member while make-plan runs (up to about a minute). Steps advance on a timer from
// the shared start time; when the response arrives the remaining steps tick off quickly, then onDone hides it.
import { useEffect, useRef, useState } from "react";
import { useT, useTNodes } from "../i18n/hooks";
import type { GrokRun } from "../lib/grokRun";
import { DemoPlanPill, QuorumSays } from "./Grok";

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
    <section ref={ref} aria-live="polite" className="mx-auto w-full max-w-xl text-center">
      <p className="text-sm font-semibold text-navy/55">{t("working.subtitle")}</p>
      <p className="font-logo mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
        {allDone ? (
          <span>{t(demo ? (backup ? "working.readyBackup" : "working.readyDemo") : "working.readyGrok")}</span>
        ) : (
          <span key={doneCount} className="shimmer-text">
            {tNodes(SAYS[Math.min(doneCount, SAYS.length - 1)], { grok: <b>Grok</b> })}
          </span>
        )}
      </p>
      <p className="mt-3 font-mono text-sm tabular-nums text-navy/45">{clock}</p>
      {!isMine && !allDone && <p className="mt-2 text-sm text-navy/55">{t("working.askedBy", { name: run.by })}</p>}

      <ol className="mx-auto mt-8 w-fit space-y-2.5 text-start">
        {STEPS.map((label, i) => {
          const state = i < doneCount ? "done" : i === doneCount && !allDone ? "active" : "todo";
          return (
            <li key={label} className="flex items-center gap-3">
              {state === "done" ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500 text-xs font-bold text-white motion-safe:animate-pop">
                  ✓
                </span>
              ) : state === "active" ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-navy bg-sun">
                  <span className="h-2 w-2 rounded-[2px] bg-navy motion-safe:animate-spin" />
                </span>
              ) : (
                <span className="h-6 w-6 shrink-0 rounded-md border-2 border-dashed border-navy/25 bg-white" />
              )}
              <span
                className={`text-sm transition-colors ${
                  state === "done" ? "text-navy/75" : state === "active" ? "font-semibold text-navy" : "text-navy/40"
                }`}
              >
                {t(label)}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mx-auto mt-8 h-1.5 max-w-sm overflow-hidden rounded-full bg-navy/10">
        <div
          className="h-full bg-sun transition-[width] duration-500"
          style={{ width: `${Math.max(6, (doneCount / STEPS.length) * 100)}%` }}
        />
      </div>

      {!allDone && (
        <p className="mx-auto mt-3 max-w-sm text-sm text-navy/55">
          {elapsedS > SLOW_AFTER_S
            ? t("working.slow")
            : t("working.usual")}
        </p>
      )}
      {allDone && (
        <div className="mx-auto mt-4 w-fit text-start">
          <QuorumSays tag={demo && <DemoPlanPill backup={backup} />}>
            {backup
              ? t("working.doneBackup")
              : demo
                ? t("working.doneDemo")
                : t("working.doneGrok")}
          </QuorumSays>
        </div>
      )}
    </section>
  );
}
