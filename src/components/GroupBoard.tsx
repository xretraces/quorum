// Group board: members, live chat, Generate Plan (Grok via make-plan), plan cards with live approve/reject,
// then the locked plan with PayButton holds and the status screen. Everything refetches on Realtime changes.
import { useCallback, useEffect, useState } from "react";
import { type Group, invoke, type Member, myMemberId, type Payment, type Plan, rejectionOf, supabase, usd } from "../lib/supabase";
import { buildFallbackPlans } from "../lib/fallback";
import { GroupChat } from "./GroupChat";
import { LockedPlan } from "./LockedPlan";
import { PlanCard } from "./PlanCard";
import { TOO_EXPENSIVE } from "./RejectButton";

type SpeechRec = { lang: string; start: () => void; onresult: (e: { results: { transcript: string }[][] }) => void; onerror: () => void };

export function GroupBoard({ groupId, onHome }: { groupId: string; onHome: () => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [chatTranscript, setChatTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const meId = myMemberId(groupId);
  const me = members.find((m) => m.id === meId);

  const load = useCallback(async () => {
    const [g, m, p, pay] = await Promise.all([
      supabase.from("groups").select("*").eq("id", groupId).maybeSingle(),
      supabase.from("members").select("*").eq("group_id", groupId).order("created_at"),
      supabase.from("plans").select("*").eq("group_id", groupId).order("option_index"),
      supabase.from("payments").select("*").eq("group_id", groupId),
    ]);
    if (g.error) setErr(g.error.message);
    else if (!g.data) setErr("Group not found. Please check the group code.");
    else setGroup(g.data as Group);
    setMembers((m.data ?? []) as Member[]);
    setPlans((p.data ?? []) as Plan[]);
    setPayments((pay.data ?? []) as Payment[]);
  }, [groupId]);

  useEffect(() => {
    load();
    const filter = `group_id=eq.${groupId}`;
    const channel = supabase
      .channel(`board-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "members", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "plans", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, load]);

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
      const { rejection: _cleared, ...rest } = me.constraints ?? {};
      void _cleared;
      const { error } = await supabase.from("members").update({ vote_plan_id: planId, constraints: rest }).eq("id", me.id);
      if (error) throw error;
    });

  const lock = (planId: string) => run("lock", () => invoke("pay", { action: "hold", group_id: groupId, plan_id: planId }));
  const cancel = () => run("cancel", () => invoke("pay", { action: "cancel", group_id: groupId }));
  const recap = () => run("recap", () => invoke("recap-image", { group_id: groupId }));

  const planIds = plans.map((p) => p.id);
  const rejections = members.flatMap((m) => {
    const r = rejectionOf(m, planIds);
    return r ? [{ member: m, ...r }] : [];
  });
  const tooExpensive = rejections.some((r) => r.reason === TOO_EXPENSIVE);
  const liveHolds = payments.some((p) => p.status !== "canceled");

  async function generate(hardCap: boolean) {
    const base = [chatTranscript, notes].filter((s) => s.trim()).join("\n");
    if (!base.trim()) return setErr("Please add some conversation details before generating a plan.");
    const capRule = hardCap
      ? "\n\n[Quorum] HARD LIMIT after a 'too expensive' rejection. Every plan must fit these per-person caps: " +
        members.map((m) => `${m.display_name} ${usd(m.budget_cap_cents)}`).join(", ") + "."
      : "";
    setBusy("grok");
    setErr(null);
    setInfo(null);
    try {
      if (liveHolds) await invoke("pay", { action: "cancel", group_id: groupId }); // make-plan refuses while holds are live
      try {
        await invoke("make-plan", { group_id: groupId, transcript: base + capRule, hard_cap: hardCap });
      } catch (e) {
        console.error("make-plan failed, using saved demo plan", e);
        await applyFallback(hardCap);
        setInfo(`Grok is unavailable right now (${e instanceof Error ? e.message : String(e)}). Showing a saved demo plan instead.`);
      }
      await load();
    } catch (e) {
      setErr(`We couldn't generate a plan right now. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function applyFallback(hardCap: boolean) {
    const rows = buildFallbackPlans(groupId, members, hardCap);
    if (rows.length === 0) throw new Error("No saved plan fits everyone's cap.");
    const g = await supabase.from("groups").update({ status: "voting", selected_plan_id: null }).eq("id", groupId);
    if (g.error) throw g.error;
    const r = await supabase.from("members").update({ vote_plan_id: null, approved: false, approved_amount_cents: null, approved_at: null }).eq("group_id", groupId);
    if (r.error) throw r.error;
    const d = await supabase.from("plans").delete().eq("group_id", groupId);
    if (d.error) throw d.error;
    const i = await supabase.from("plans").insert(rows);
    if (i.error) throw i.error;
  }

  // TODO(grok-voice): swap browser speech-to-text for Grok Voice / xAI speech-to-text (SpaceXAI challenge).
  function dictate() {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return setErr("Speech recognition isn't supported in this browser (try Chrome).");
    const rec = new SR();
    rec.lang = "en-US";
    rec.onresult = (e) => setNotes((t) => `${t ? `${t}\n` : ""}${me?.display_name ?? "Me"} (voice): ${e.results[0][0].transcript}`);
    rec.onerror = () => setErr("Voice recognition failed. Try again.");
    rec.start();
  }

  const locked = plans.find((p) => p.id === group?.selected_plan_id);
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

  const inviteUrl = `${window.location.origin}/join/${group.invite_code}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <header className="flex items-center gap-3">
          <a
            href="/"
            onClick={home}
            aria-label="Back to your groups"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-xl text-indigo-600 shadow-md transition-colors hover:bg-indigo-50"
          >
            ←
          </a>
          <div className="min-w-0 flex-1">
            <a href="/" onClick={home} className="text-xs font-bold uppercase tracking-wide text-indigo-600">Quorum · Your groups</a>
            <h1 className="truncate text-2xl font-bold text-gray-900">{group.name}</h1>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">{group.status}</span>
        </header>

        {!me && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            You're viewing this group but haven't joined on this device. <a className="underline" href={`/join/${group.invite_code}`}>Join</a>
          </p>
        )}

        <section className="rounded-2xl bg-white p-4 shadow-md">
          <h2 className="mb-2 font-semibold text-gray-900">Who's in ({members.length})</h2>
          {!locked && (
            <div className="mb-3 rounded-lg bg-gray-50 p-2">
              <p className="text-xs text-gray-600">
                Group code <b className="font-mono">{group.invite_code}</b> · share this link:
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded border bg-white px-2 py-1 text-xs">{inviteUrl}</code>
                <button onClick={() => navigator.clipboard.writeText(inviteUrl)} className="text-xs font-medium text-indigo-600">Copy</button>
              </div>
            </div>
          )}
          <ul className="flex flex-wrap gap-2">
            {members.map((m) => (
              <li key={m.id} className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm text-indigo-800">
                {m.display_name}
                {m.is_organizer && " 👑"}
                <span className="text-indigo-600"> · {usd(m.budget_cap_cents)}</span>
                {m.dietary && <span className="text-indigo-500"> · {m.dietary}</span>}
              </li>
            ))}
          </ul>
        </section>

        {rejections.length > 0 && (
          <section className="space-y-2 rounded-2xl border-2 border-red-200 bg-red-50 p-4">
            {rejections.map((r) => (
              <p key={r.member.id} className="text-sm text-red-800">
                <b>{r.member.display_name}</b> rejected the plan. Reason: {r.reason}.
              </p>
            ))}
            <p className="text-sm text-red-700">This plan can't be booked. Back to planning.</p>
            {me?.is_organizer ? (
              <button
                disabled={!!busy}
                onClick={() => generate(tooExpensive)}
                className="w-full rounded-xl bg-gray-900 p-3 font-semibold text-white disabled:opacity-50"
              >
                {busy === "grok" ? "Grok is replanning…" : tooExpensive ? "✨ Modify plan: regenerate within everyone's cap" : "✨ Modify plan: regenerate"}
              </button>
            ) : (
              <p className="text-xs text-red-600">Waiting for the organizer to modify the plan.</p>
            )}
          </section>
        )}

        {(!locked || rejections.length > 0) && (
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-md">
            <h2 className="font-semibold text-gray-900">Group Chat</h2>
            <GroupChat groupId={groupId} memberName={me?.display_name ?? "Guest"} onTranscriptChange={setChatTranscript} />
          </section>
        )}

        {me?.is_organizer && !locked && (
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-md">
            <h2 className="font-semibold text-gray-900">Generate Plan</h2>
            <p className="text-sm text-gray-600">
              Grok reads the chat above plus anything you add here, extracts everyone's budget, diet, time, and transport, and proposes plans.
            </p>
            <textarea
              className="h-20 w-full resize-none rounded-lg border border-gray-300 p-3 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={"Optional: paste chat from elsewhere or add voice notes\nPriya: nothing over 25, no car"}
            />
            <div className="flex flex-wrap gap-2">
              <button
                disabled={!!busy}
                onClick={() => generate(false)}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
              >
                {busy === "grok" ? "Grok is planning…" : plans.length ? "✨ Generate new plans" : "✨ Generate Plan"}
              </button>
              <button onClick={dictate} className="rounded-xl border border-gray-300 px-4 py-3 text-gray-700 transition-colors hover:bg-gray-50">
                🎙 Voice
              </button>
            </div>
          </section>
        )}

        {!locked && plans.length > 0 && (
          <section className="space-y-4">
            <h2 className="px-1 font-semibold text-gray-900">Approve or reject a plan</h2>
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} members={members} me={me} onVote={() => vote(p.id)} onLock={() => lock(p.id)} busy={!!busy} />
            ))}
          </section>
        )}

        {locked && (
          <LockedPlan
            group={group}
            plan={locked}
            members={members}
            payments={payments}
            me={me}
            rejected={rejections.length > 0}
            onRefresh={load}
            onCancel={cancel}
            onRecap={recap}
            busy={!!busy}
          />
        )}

        {info && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{info}</div>}
        {err && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {err}
            {err.startsWith("We couldn't generate") && (
              <button onClick={() => generate(tooExpensive)} className="ml-2 font-semibold underline">Try Again</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
