// Shares "Grok is working" with every phone in the group. make-plan writes nothing until it finishes and
// groups.status has no "generating" value, so the organizer's phone announces the run on a Realtime presence
// channel (no table writes). Presence also reaches members who open the group mid-run.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type GrokOutcome = "working" | "grok" | "demo";
export type GrokRun = { startedAt: number; finishedAt: number | null; outcome: GrokOutcome; by: string };

const STALE_WORKING_MS = 4 * 60_000;
const STALE_DONE_MS = 10_000;

export function useGrokRun(groupId: string) {
  const [remote, setRemote] = useState<GrokRun | null>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const joined = useRef(false);
  const pending = useRef<GrokRun | null>(null);
  // Local receive time of each run's finish, so the finishing animation doesn't depend on the organizer's clock.
  const finishSeen = useRef(new Map<number, number>());

  useEffect(() => {
    const key = Math.random().toString(36).slice(2);
    const ch = supabase.channel(`grok-${groupId}`, { config: { presence: { key } } });
    ch.on("presence", { event: "sync" }, () => {
      const now = Date.now();
      const runs = Object.entries(ch.presenceState<{ run: GrokRun | null }>())
        .filter(([k]) => k !== key)
        .flatMap(([, metas]) => metas.map((m) => m.run))
        .filter((r): r is GrokRun => !!r)
        .filter((r) => (r.finishedAt === null ? now - r.startedAt < STALE_WORKING_MS : now - r.finishedAt < STALE_DONE_MS));
      const latest = runs.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
      if (latest?.finishedAt && !finishSeen.current.has(latest.startedAt)) finishSeen.current.set(latest.startedAt, now);
      setRemote(latest && latest.finishedAt ? { ...latest, finishedAt: finishSeen.current.get(latest.startedAt)! } : latest);
    });
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      joined.current = true;
      if (pending.current) ch.track({ run: pending.current });
    });
    channel.current = ch;
    return () => {
      joined.current = false;
      channel.current = null;
      supabase.removeChannel(ch);
    };
  }, [groupId]);

  const announce = useCallback((run: GrokRun | null) => {
    pending.current = run;
    if (joined.current) channel.current?.track({ run });
  }, []);

  return { remote, announce };
}
