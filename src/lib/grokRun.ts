// Shares "Grok is working" with every phone in the group. make-plan writes nothing until it finishes and
// groups.status has no "generating" value, so the organizer's phone announces the run on a Realtime channel
// (no table writes). Presence reaches members who open the group mid-run; broadcast is sent alongside it
// because a presence sync can be missed or lag (rejoins, joining right as the run starts).
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type GrokOutcome = "working" | "grok" | "backup" | "demo";
export type GrokRun = { startedAt: number; finishedAt: number | null; outcome: GrokOutcome; by: string };

const STALE_WORKING_MS = 4 * 60_000;
const STALE_DONE_MS = 10_000;

/** Of two reports from the same phone, keep the newer run, and its finished version over the working one. */
const newer = (a: GrokRun | null | undefined, b: GrokRun | null) =>
  !a || !b || b.startedAt > a.startedAt || (b.startedAt === a.startedAt && b.finishedAt !== null) ? b : a;

export function useGrokRun(groupId: string) {
  const [remote, setRemote] = useState<GrokRun | null>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const sendRun = useRef<((run: GrokRun | null) => void) | null>(null);
  const joined = useRef(false);
  const mine = useRef<GrokRun | null>(null);
  // Local receive time of each run's finish, so the finishing animation doesn't depend on the organizer's clock.
  const finishSeen = useRef(new Map<number, number>());

  useEffect(() => {
    const key = Math.random().toString(36).slice(2);
    const runs = new Map<string, GrokRun | null>();
    const ch = supabase.channel(`grok-${groupId}`, { config: { presence: { key } } });

    const publish = () => {
      const now = Date.now();
      const live = [...runs.values()]
        .filter((r): r is GrokRun => !!r)
        .filter((r) => (r.finishedAt === null ? now - r.startedAt < STALE_WORKING_MS : now - r.finishedAt < STALE_DONE_MS));
      const latest = live.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
      if (latest?.finishedAt && !finishSeen.current.has(latest.startedAt)) finishSeen.current.set(latest.startedAt, now);
      setRemote(latest && latest.finishedAt ? { ...latest, finishedAt: finishSeen.current.get(latest.startedAt)! } : latest);
    };
    const receive = (from: string, run: GrokRun | null) => {
      if (from === key) return;
      runs.set(from, run === null ? null : newer(runs.get(from), run));
      publish();
    };
    const send = (run: GrokRun | null) => ch.send({ type: "broadcast", event: "run", payload: { from: key, run } });

    ch.on("presence", { event: "sync" }, () => {
      for (const [k, metas] of Object.entries(ch.presenceState<{ run: GrokRun | null }>())) {
        for (const m of metas) if (m.run) receive(k, m.run);
      }
    });
    ch.on("broadcast", { event: "run" }, ({ payload }) => receive(payload.from, payload.run));
    ch.on("broadcast", { event: "ask" }, () => mine.current && send(mine.current));
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      joined.current = true;
      if (mine.current) {
        ch.track({ run: mine.current });
        send(mine.current);
      }
      ch.send({ type: "broadcast", event: "ask", payload: {} });
    });
    channel.current = ch;
    sendRun.current = send;
    return () => {
      joined.current = false;
      channel.current = null;
      sendRun.current = null;
      supabase.removeChannel(ch);
    };
  }, [groupId]);

  const announce = useCallback((run: GrokRun | null) => {
    mine.current = run;
    if (!joined.current) return;
    channel.current?.track({ run });
    sendRun.current?.(run);
  }, []);

  return { remote, announce };
}
