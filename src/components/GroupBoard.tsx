// Group board: lobby (QR invite, live members + ready checks, "Fill out my answers") with the private questionnaire on its
// own page (/g/:id/answers; saving returns to the lobby) -> the creator asks Grok
// (make-plan reads everyone's private answers server-side) with the shared "Grok is working" steps -> plan cards
// with real venue photos and live "I'm in" votes -> once everyone has voted, the top plan wins (the creator
// breaks ties) and every phone switches to "Your plan". Everything refetches on Realtime changes.
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/hooks";
import { buildFallbackPlans } from "../lib/fallback";
import { type GrokOutcome, type GrokRun, useGrokRun } from "../lib/grokRun";
import { isClosed } from "../lib/invite";
import { type Group, invoke, InvokeError, type Member, myMemberId, type Plan, supabase } from "../lib/supabase";
import { FinalPlan } from "./FinalPlan";
import { GrokWorking } from "./GrokWorking";
import { Lobby } from "./Lobby";
import { PlanCard } from "./PlanCard";
import { Questionnaire } from "./Questionnaire";
import { QuorumHeader } from "./QuorumHeader";

export type Navigate = { replace?: boolean; state?: unknown };

const backLink =
  "inline-flex shrink-0 items-center text-2xl leading-none text-navy/70 transition-colors hover:text-navy";
type Page = "lobby" | "answers";

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

/** i18n keys of the plan's badges. */
function labelsFor(plan: Plan, plans: Plan[]) {
  const min = Math.min(...plans.map((p) => p.per_person_cents));
  const out: string[] = [];
  if (plan.fits_everyone) out.push("plan.fitsEveryone");
  if (plans.length > 1 && plan.per_person_cents === min && plans.some((p) => p.per_person_cents !== min)) out.push("plan.cheapest");
  return out;
}

type Props = { groupId: string; page: Page; navigate: (path: string, opts?: Navigate) => void; onHome: () => void };

export function GroupBoard({ groupId, page, navigate, onHome }: Props) {
  const t = useT();
  const [savedNote, setSavedNote] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false); // translated at render, so load() stays language-independent
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
    else if (!g.data) setNotFound(true);
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
  const stage = grokRun ? "grok" : winner ? "final" : plans.length ? "vote" : "lobby";

  const lobbyPath = `/g/${groupId}`;
  const openAnswers = () => navigate(`${lobbyPath}/answers`, { state: { fromLobby: true } });
  /** Back to the lobby: pop the answers entry if we came from the lobby, else replace it (deep link / fresh join). */
  const backToLobby = useCallback(() => {
    if ((window.history.state as { fromLobby?: boolean } | null)?.fromLobby) window.history.back();
    else navigate(lobbyPath, { replace: true });
  }, [navigate, lobbyPath]);

  // The answers page is only for members while the group is still collecting answers: non-members go to the join page
  // (or the board if the group is closed), and once Grok is working or plans exist everyone is sent to the board.
  useEffect(() => {
    if (page !== "answers" || !group) return;
    if (!me) navigate(isClosed(group) ? lobbyPath : `/join/${group.invite_code}`, { replace: true });
    else if (stage !== "lobby") navigate(lobbyPath, { replace: true });
  }, [page, group, me, stage, navigate, lobbyPath]);

  useEffect(() => {
    if (!savedNote) return;
    const id = window.setTimeout(() => setSavedNote(false), 3500);
    return () => window.clearTimeout(id);
  }, [savedNote]);

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

  // Grok Imagine only paints the WINNING plan's poster (plan cards show real venue photos): the creator asks once.
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
    const started: GrokRun = { startedAt: Date.now(), finishedAt: null, outcome: "working", by: me?.display_name ?? t("common.theCreatorStart") };
    const finishRun = (outcome: GrokOutcome | null) => {
      const next = outcome ? { ...started, finishedAt: Date.now(), outcome } : null;
      setMyRun(next);
      announce(next);
    };
    setMyRun(started);
    announce(started);
    try {
      try {
        const res = await invoke<{ plans: Plan[]; source: "grok" | "backup" }>("make-plan", { group_id: groupId });
        finishRun(res.source === "backup" ? "backup" : "grok");
      } catch (e) {
        // A deliberate refusal (not enough answers, nothing fits, already decided) is shown as is.
        if (e instanceof InvokeError && e.fromFunction && e.status !== undefined && [400, 404, 409, 422].includes(e.status)) throw e;
        console.error("make-plan failed, using saved demo plans", e);
        await applyFallback();
        finishRun("demo");
        setInfo(t("board.grokUnreachable", { error: e instanceof Error ? e.message : String(e) }));
      }
      await load(); // no per-plan Grok Imagine calls any more: cards use venue photos
    } catch (e) {
      finishRun(null);
      setErr(t("board.planFailed", { error: e instanceof Error ? e.message : String(e) }));
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
      <div className="quorum-inner relative isolate min-h-dvh">
        <div className="relative z-20 bg-spring-deep px-5 pt-[max(1.15rem,env(safe-area-inset-top))] pb-4 sm:px-8">
          <QuorumHeader groupId={groupId} showLogo tone="onSpring" />
        </div>
        <div className="relative z-10 px-5 pt-8 sm:px-8">
          <p className={`text-navy/70 ${err || notFound ? "" : "motion-safe:animate-pulse"}`}>{err ?? (notFound ? t("board.groupNotFound") : t("common.loading"))}</p>
          {(err || notFound) && <a href="/" onClick={home} className="mt-3 inline-flex text-sm font-semibold text-navy underline underline-offset-4">{t("board.backHome")}</a>}
        </div>
      </div>
    );
  }

  const organizer = members.find((m) => m.is_organizer);
  if (page === "answers") {
    const toLobby = (e: React.MouseEvent) => {
      e.preventDefault();
      backToLobby();
    };
    return (
      <div className="quorum-inner relative isolate min-h-dvh">
        <div className="relative z-20 bg-spring-deep px-5 pt-[max(1.15rem,env(safe-area-inset-top))] pb-4 sm:px-8">
          <QuorumHeader groupId={groupId} showLogo tone="onSpring" />
        </div>
        <div className="relative z-10 px-5 pt-5 sm:px-8">
          <a href={lobbyPath} onClick={toLobby} aria-label={t("answers.back")} className={backLink}>
            <span className="inline-block rtl:-scale-x-100">←</span>
          </a>
        </div>
        <main className="relative z-10 mx-auto w-full max-w-[40rem] px-5 pb-16 pt-4 sm:px-8">
          {me && stage === "lobby" ? (
            <Questionnaire
              memberId={me.id}
              intro={
                <header className="q-paper">
                  <p dir="auto" className="text-sm font-semibold text-navy/55">{t("answers.backTo", { group: group.name })}</p>
                  <h1 className="font-logo mt-2 text-3xl leading-[1.05] font-bold tracking-tight text-navy sm:text-4xl">
                    {t("lobby.yourAnswers")}
                  </h1>
                  <p className="mt-3 text-base leading-relaxed text-navy/70">
                    {t(me.prefs_ready ? "answers.introEdit" : "answers.intro")}
                  </p>
                  <p className="mt-4 text-sm font-medium text-navy/80">{t("q.private")}</p>
                </header>
              }
              onSaved={() => {
                setSavedNote(true);
                void load();
                backToLobby();
              }}
            />
          ) : (
            <p className="text-navy/70 motion-safe:animate-pulse">{t("common.loading")}</p>
          )}
          {err && <div role="alert" className="q-alert q-alert-error mt-4">{err}</div>}
        </main>
      </div>
    );
  }

  return (
    <div className="quorum-inner relative isolate min-h-dvh">
      <div className="relative z-20 bg-spring-deep px-5 pt-[max(1.15rem,env(safe-area-inset-top))] pb-4 sm:px-8">
        <QuorumHeader groupId={groupId} showLogo tone="onSpring" />
      </div>
      <div className="relative z-10 px-5 pt-5 pb-12 sm:px-8">
        <header className="flex items-center gap-4">
          <a href="/" onClick={home} aria-label={t("board.backAria")} className={backLink}>
            <span className="inline-block rtl:-scale-x-100">←</span>
          </a>
          <h1 dir="auto" className="font-logo min-w-0 truncate text-3xl font-bold tracking-tight text-navy sm:text-4xl rtl:text-right">{group.name}</h1>
        </header>

        <div className="mt-8">
        {!me && (
          <p className="q-alert q-alert-info mb-6 max-w-2xl">
            {isClosed(group) ? (
              t("board.viewingClosed")
            ) : (
              <>
                {t("board.viewingNotJoined")}{" "}
                <a className="inline-block py-2 font-semibold underline" href={`/join/${group.invite_code}`}>{t("board.join")}</a>
              </>
            )}
          </p>
        )}

        {stage === "lobby" && (
          <Lobby group={group} members={members} me={me} busy={!!busy} saved={savedNote} onAskGrok={askGrok} onOpenAnswers={openAnswers} />
        )}

        {grokRun && (
          <div className="mb-10">
            <GrokWorking key={grokRun.startedAt} run={grokRun} isMine={grokRun === myRun} onDone={dismissGrokRun} />
          </div>
        )}

        {stage === "vote" && (
          <section className="space-y-8">
            <div>
              <h2 className="font-logo text-3xl font-bold tracking-tight text-navy sm:text-4xl">{t("board.whichPlan")}</h2>
              <p className="q-muted mt-2 max-w-xl">
                {t("board.votedCount", { voted, total: members.length })}
              </p>
            </div>
            {tied.length > 0 && (
              <p className="max-w-xl text-sm font-semibold text-navy">
                {t("board.tie")}{" "}
                {me?.is_organizer ? t("board.tieCreator") : t("board.tieWaiting", { name: organizer?.display_name ?? t("common.theCreator") })}
              </p>
            )}
            <div className="grid items-start gap-10 lg:grid-cols-2 xl:grid-cols-3">
              {plans.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  labels={labelsFor(p, plans).map((k) => t(k))}
                  voters={members.filter((m) => m.vote_plan_id === p.id)}
                  memberCount={members.length}
                  isMyVote={me?.vote_plan_id === p.id}
                  canVote={!!me}
                  busy={!!busy}
                  onVote={() => vote(p.id)}
                  onPick={me?.is_organizer && tied.some((t) => t.id === p.id) ? () => pick(p.id) : undefined}
                />
              ))}
            </div>
            {me?.is_organizer && (
              <button
                disabled={!!busy}
                onClick={askGrok}
                className="q-btn q-btn-secondary text-sm"
              >
                {t("board.askAgain")}
              </button>
            )}
          </section>
        )}

        {stage === "final" && winner && (
          <FinalPlan group={group} plan={winner} members={members} painting={painting.has("final") || painting.has(winner.id)} />
        )}

        {info && <div className="q-alert q-alert-info mt-6 max-w-xl">{info}</div>}
        {err && <div role="alert" className="q-alert q-alert-error mt-6 max-w-xl">{err}</div>}
        </div>
      </div>
    </div>
  );
}
