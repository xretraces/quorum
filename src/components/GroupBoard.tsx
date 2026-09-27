// Group board: lobby (QR invite, live members + ready checks, private questionnaire) -> the creator asks Grok
// (make-plan reads everyone's private answers server-side) with the shared "Grok is working" steps -> plan cards
// with Grok Imagine pictures and live "I'm in" votes -> once everyone has voted, the top plan wins (the creator
// breaks ties) and every phone switches to "Your plan". Everything refetches on Realtime changes.
import { useCallback, useEffect, useRef, useState } from "react";
import { buildFallbackPlans } from "../lib/fallback";
import { type GrokOutcome, type GrokRun, useGrokRun } from "../lib/grokRun";
import { isClosed } from "../lib/invite";
import { type Group, invoke, InvokeError, type Member, myMemberId, type Plan, statusBadge, supabase } from "../lib/supabase";
import { FinalPlan } from "./FinalPlan";
import { GrokWorking } from "./GrokWorking";
import { Lobby } from "./Lobby";
import { PlanCard } from "./PlanCard";

const PAINT_WINDOW_MS = 2 * 60_000; // other phones show "painting" this long after plans appear

/** Live tally: the winner once every member has voted and one plan has the most votes. */
function tally(plans: Plan[], members: Member[]) {
  const ids = new Set(plans.map((p) => p.id));
  const counts = new Map(plans.map((p) => [p.id, 0]));
  for (const m of members) if (m.vote_plan_id && ids.has(m.vote_plan_id)) counts.set(m.vote_plan_id, counts.get(m.vote_plan_id)! + 1);
  const voted = members.filter((m) => m.vote_plan_id && ids.has(m.vote_plan_id)).length;
  const allVoted = members.length > 0 && plans.length > 0 && voted === members.length;
  const max = Math.max(0, ...counts.values());
  const leaders = plans.filter((p) => counts.get(p.id) === max);
  return { voted, allVoted, winner: allVoted && leaders.length === 1 ? leaders[0] : null, tied: allVoted && leaders.length > 1 ? leaders : [] };
}

function labelsFor(plan: Plan, plans: Plan[]) {
  const min = Math.min(...plans.map((p) => p.per_person_cents));
  const out: string[] = [];
  if (plan.fits_everyone) out.push("Fits everyone");
  if (plans.length > 1 && plan.per_person_cents === min && plans.some((p) => p.per_person_cents !== min)) out.push("Cheapest");
  return out;
}

export function GroupBoard({ groupId, onHome }: { groupId: string; onHome: () => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [painting, setPainting] = useState<Set<string>>(new Set());
  const [myRun, setMyRun] = useState<GrokRun | null>(null);
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);
  const { remote: remoteRun, announce } = useGrokRun(groupId);
  const meId = myMemberId(groupId);
  const me = members.find((m) => m.id === meId);
  const grokRun = [myRun, remoteRun].find((r) => r && r.startedAt !== dismissedRun) ?? null;
  const dismissGrokRun = useCallback(() => setDismissedRun(grokRun?.startedAt ?? null), [grokRun?.startedAt]);
  const decideSent = useRef<string | null>(null);
  const finalRecapAsked = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [g, m, p] = await Promise.all([
      supabase.from("groups").select("*").eq("id", groupId).maybeSingle(),
      supabase.from("members").select("*").eq("group_id", groupId).order("created_at"),
      supabase.from("plans").select("*").eq("group_id", groupId).order("option_index"),
    ]);
    if (g.error) setErr(g.error.message);
    else if (!g.data) setErr("Group not found. Please check the group code.");
    else setGroup(g.data as Group);
    setMembers((m.data ?? []) as Member[]);
    setPlans((p.data ?? []) as Plan[]);
  }, [groupId]);

  useEffect(() => {
    load();
    const filter = `group_id=eq.${groupId}`;
    const channel = supabase
      .channel(`board-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "members", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "plans", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, load]);

  const winner = plans.find((p) => p.id === group?.selected_plan_id) ?? null;
  const { voted, winner: leading, tied } = tally(plans, members);

  // Everyone voted and one plan leads: record it (any phone may; the write is idempotent).
  useEffect(() => {
    if (winner || !leading || decideSent.current === leading.id) return;
    decideSent.current = leading.id;
    supabase.from("groups").update({ selected_plan_id: leading.id, status: "decided" }).eq("id", groupId).is("selected_plan_id", null)
      .then(({ error }) => {
        if (error) {
          decideSent.current = null;
          setErr(error.message);
        }
      });
  }, [winner, leading, groupId]);

  const paint = useCallback((planId: string | null) => {
    const key = planId ?? "final";
    setPainting((s) => new Set(s).add(key));
    invoke("recap-image", planId ? { group_id: groupId, plan_id: planId } : { group_id: groupId })
      .catch((e) => console.warn("recap-image failed; keeping the placeholder", e))
      .finally(() => setPainting((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      }));
  }, [groupId]);

  // Winner without a picture (per-plan pictures failed or recap-image isn't redeployed): the creator asks once.
  useEffect(() => {
    if (!winner || !me?.is_organizer || winner.recap_image_url || group?.recap_image_url) return;
    if (painting.has(winner.id) || finalRecapAsked.current === winner.id) return;
    finalRecapAsked.current = winner.id;
    paint(null);
  }, [winner, me?.is_organizer, group?.recap_image_url, painting, paint]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const vote = (planId: string) =>
    run("vote", async () => {
      if (!me) return;
      const { error } = await supabase.from("members").update({ vote_plan_id: planId }).eq("id", me.id);
      if (error) throw error;
    });

  const pick = (planId: string) =>
    run("pick", async () => {
      const { error } = await supabase.from("groups").update({ selected_plan_id: planId, status: "decided" }).eq("id", groupId);
      if (error) throw error;
    });

  async function askGrok() {
    setBusy("grok");
    setErr(null);
    setInfo(null);
    const started: GrokRun = { startedAt: Date.now(), finishedAt: null, outcome: "working", by: me?.display_name ?? "The creator" };
    const finishRun = (outcome: GrokOutcome | null) => {
      const next = outcome ? { ...started, finishedAt: Date.now(), outcome } : null;
      setMyRun(next);
      announce(next);
    };
    setMyRun(started);
    announce(started);
    try {
      let fresh: Plan[];
      try {
        const res = await invoke<{ plans: Plan[]; source: "grok" | "backup" }>("make-plan", { group_id: groupId });
        fresh = res.plans ?? [];
        finishRun(res.source === "backup" ? "backup" : "grok");
      } catch (e) {
        // A deliberate refusal (not enough answers, nothing fits, already decided) is shown as is.
        if (e instanceof InvokeError && e.fromFunction && e.status !== undefined && [400, 404, 409, 422].includes(e.status)) throw e;
        console.error("make-plan failed, using saved demo plans", e);
        fresh = await applyFallback();
        finishRun("demo");
        setInfo(`Grok couldn't be reached (${e instanceof Error ? e.message : String(e)}). Showing saved demo plans.`);
      }
      await load();
      fresh.filter((p) => !p.recap_image_url).forEach((p) => paint(p.id));
    } catch (e) {
      finishRun(null);
      setErr(`We couldn't make plans right now. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function applyFallback(): Promise<Plan[]> {
    const g = await supabase.from("groups").update({ status: "voting", selected_plan_id: null, recap_image_url: null }).eq("id", groupId);
    if (g.error) throw g.error;
    const r = await supabase.from("members").update({ vote_plan_id: null }).eq("group_id", groupId);
    if (r.error) throw r.error;
    const d = await supabase.from("plans").delete().eq("group_id", groupId);
    if (d.error) throw d.error;
    const i = await supabase.from("plans").insert(buildFallbackPlans(groupId, members.length)).select("*");
    if (i.error) throw i.error;
    return (i.data ?? []) as Plan[];
  }

  const home = (e: React.MouseEvent) => {
    e.preventDefault();
    onHome();
  };

  if (!group) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gradient-to-b from-indigo-50 to-white p-4">
        <p className="text-gray-600">{err ?? "Loading…"}</p>
        {err && <a href="/" onClick={home} className="text-indigo-600 underline">Back home</a>}
      </div>
    );
  }

  const organizer = members.find((m) => m.is_organizer);
  const recentlyMade = (p: Plan) => !!p.created_at && Date.now() - new Date(p.created_at).getTime() < PAINT_WINDOW_MS;
  const isPainting = (p: Plan) => painting.has(p.id) || (!p.recap_image_url && recentlyMade(p));
  const stage = grokRun ? "grok" : winner ? "final" : plans.length ? "vote" : "lobby";
  const badge = winner ? statusBadge("decided") : statusBadge(group.status);

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
      <div className="mx-auto max-w-md space-y-4 p-4">
        <header className="flex items-center gap-3">
          <a
            href="/"
            onClick={home}
            aria-label="Back to your groups"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl text-indigo-600 shadow-md transition-colors hover:bg-indigo-50"
          >
            ←
          </a>
          <div className="min-w-0 flex-1">
            <a href="/" onClick={home} className="text-xs font-bold uppercase tracking-wide text-indigo-600">Quorum · Your groups</a>
            <h1 className="truncate text-2xl font-bold text-gray-900">{group.name}</h1>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${badge.cls}`}>{badge.label}</span>
        </header>

        {!me && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            {isClosed(group) ? (
              "You're viewing this group's plan. It isn't taking new people."
            ) : (
              <>
                You're viewing this group but haven't joined on this device.{" "}
                <a className="inline-block py-2 font-semibold underline" href={`/join/${group.invite_code}`}>Join</a>
              </>
            )}
          </p>
        )}

        {stage === "lobby" && (
          <Lobby group={group} members={members} me={me} busy={!!busy} onAskGrok={askGrok} onRefresh={load} />
        )}

        {grokRun && <GrokWorking key={grokRun.startedAt} run={grokRun} isMine={grokRun === myRun} onDone={dismissGrokRun} />}

        {stage === "vote" && (
          <section className="space-y-4">
            <div className="px-1">
              <h2 className="text-lg font-bold text-gray-900">Which plan are you in for?</h2>
              <p className="text-sm text-gray-600">
                {voted} of {members.length} voted. When everyone has voted, the most votes wins.
              </p>
            </div>
            {tied.length > 0 && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                It's a tie!{" "}
                {me?.is_organizer ? "You're the creator, so you pick the winner below." : `Waiting for ${organizer?.display_name ?? "the creator"} to pick.`}
              </p>
            )}
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                labels={labelsFor(p, plans)}
                voters={members.filter((m) => m.vote_plan_id === p.id)}
                memberCount={members.length}
                isMyVote={me?.vote_plan_id === p.id}
                canVote={!!me}
                painting={isPainting(p)}
                busy={!!busy}
                onVote={() => vote(p.id)}
                onPick={me?.is_organizer && tied.some((t) => t.id === p.id) ? () => pick(p.id) : undefined}
              />
            ))}
            {me?.is_organizer && (
              <button
                disabled={!!busy}
                onClick={askGrok}
                className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                ✨ Ask Grok for new plans (resets votes)
              </button>
            )}
          </section>
        )}

        {stage === "final" && winner && (
          <FinalPlan group={group} plan={winner} members={members} painting={painting.has("final") || painting.has(winner.id)} />
        )}

        {info && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{info}</div>}
        {err && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}
      </div>
    </div>
  );
}
