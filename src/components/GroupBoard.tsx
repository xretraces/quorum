// Group board: lobby (QR invite, live members + ready checks, "Fill out my answers") with the private questionnaire on its
// own page (/g/:id/answers) -> once a member's answers are in, a "Waiting on others" screen (no QR; "Invite more" reopens
// the lobby) -> when the last member answers, their phone starts make-plan on its own (the creator can also start early)
// (make-plan reads everyone's private answers server-side) with the shared "Grok is working" steps -> plan cards
// with real venue photos and live "I'm in" votes -> once everyone has voted, the top plan wins (the creator
// breaks ties) and every phone switches to "Your plan". Everything refetches on Realtime changes.
// Plans go stale when someone joins after they were made, or anyone saves answers while they're up (before a winner):
// the saving phone clears them (clearPlans) and, once everyone currently in the group is ready, reruns make-plan with
// all members' answers, so old solo plans are never shown as the group's final options.
import { useCallback, useEffect, useRef, useState } from "react";
import { iso } from "../i18n/bidi";
import { useT, useTNodes } from "../i18n/hooks";
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
import { Waiting } from "./Waiting";

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

/** True when someone joined after the current plans were made: their answers aren't in them yet. */
function plansAreStale(plans: Plan[], members: Member[]): boolean {
  const made = Math.min(...plans.map((p) => (p.created_at ? Date.parse(p.created_at) : Infinity)));
  if (!plans.length || !Number.isFinite(made)) return false;
  return members.some((m) => m.created_at && Date.parse(m.created_at) > made);
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
  const tNodes = useTNodes();
  const [savedNote, setSavedNote] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false); // translated at render, so load() stays language-independent
  const [painting, setPainting] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [myRun, setMyRun] = useState<GrokRun | null>(null);
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);
  const { remote: remoteRun, announce } = useGrokRun(groupId);
  const meId = myMemberId(groupId);
  const me = members.find((m) => m.id === meId);
  const grokRun = [myRun, remoteRun].find((r) => r && r.startedAt !== dismissedRun) ?? null;
  const dismissGrokRun = useCallback(() => setDismissedRun(grokRun?.startedAt ?? null), [grokRun?.startedAt]);
  const decideSent = useRef<string | null>(null);
  const [inviting, setInviting] = useState(false);
  // Set when this phone saves answers: if that save made everyone ready, this phone (the last to answer) starts the plans.
  const autoPlan = useRef(false);

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
  const stale = !winner && plansAreStale(plans, members);
  const stage = grokRun ? "grok" : winner ? "final" : plans.length && !stale ? "vote" : "lobby";
  const allReady = members.length > 0 && members.every((m) => m.prefs_ready);

  const lobbyPath = `/g/${groupId}`;
  const openAnswers = () => navigate(`${lobbyPath}/answers`, { state: { fromLobby: true } });
  /** Back to the lobby: pop the answers entry if we came from the lobby, else replace it (deep link / fresh join). */
  const backToLobby = useCallback(() => {
    if ((window.history.state as { fromLobby?: boolean } | null)?.fromLobby) window.history.back();
    else navigate(lobbyPath, { replace: true });
  }, [navigate, lobbyPath]);

  // The answers page is only for members while the group is still collecting answers: non-members go to the join page
  // (or the board if the group is closed). Answers stay editable while voting (saving then remakes the plans); once
  // Quorum is working or a plan has won, everyone is sent to the board.
  const canAnswer = stage === "lobby" || stage === "vote";
  useEffect(() => {
    if (page !== "answers" || !group) return;
    if (!me) navigate(isClosed(group) ? lobbyPath : `/join/${group.invite_code}`, { replace: true });
    else if (!canAnswer) navigate(lobbyPath, { replace: true });
  }, [page, group, me, canAnswer, navigate, lobbyPath]);

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

  // The final screen shows real photos of the places. A Grok Imagine poster is only made when a member asks for it
  // ("Make a Grok poster"), never automatically, so no image calls are spent unless someone wants one.
  const makePoster = useCallback(() => {
    setPosterFailed(false);
    setPainting(true);
    invoke("recap-image", { group_id: groupId })
      .then(() => load())
      .catch((e) => {
        console.warn("recap-image failed", e);
        setPosterFailed(true);
      })
      .finally(() => setPainting(false));
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

  /**
   * New or changed answers make the current plans stale: drop them (and the votes) so no phone keeps showing plans
   * that ignore someone's answers. Never after a plan has won.
   */
  async function clearPlans() {
    if (!plans.length || group?.selected_plan_id) return;
    const r = await supabase.from("members").update({ vote_plan_id: null }).eq("group_id", groupId);
    if (r.error) throw r.error;
    const d = await supabase.from("plans").delete().eq("group_id", groupId);
    if (d.error) throw d.error;
    const g = await supabase.from("groups").update({ status: "planning" }).eq("id", groupId).is("selected_plan_id", null);
    if (g.error) throw g.error;
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

  // The last member to answer starts make-plan, so nobody has to press "Make the plan". Only the phone that just saved
  // tries, after a short random delay; any run announced by another phone (or plans appearing) cancels it.
  const askGrokRef = useRef(askGrok);
  useEffect(() => {
    askGrokRef.current = askGrok;
  });
  useEffect(() => {
    if (!autoPlan.current || page !== "lobby" || stage !== "lobby" || busy || !allReady) return;
    const id = window.setTimeout(() => {
      autoPlan.current = false;
      void askGrokRef.current();
    }, 250 + Math.random() * 750);
    return () => window.clearTimeout(id);
  }, [page, stage, busy, allReady]);

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
          {me && canAnswer ? (
            <Questionnaire
              memberId={me.id}
              intro={
                <header className="q-paper">
                  <p className="break-words text-sm font-semibold text-navy/70">{tNodes("answers.backTo", { group: iso(group.name) })}</p>
                  <h1 className="font-logo mt-2 text-3xl leading-[1.05] font-bold tracking-tight text-navy sm:text-4xl">
                    {t("lobby.yourAnswers")}
                  </h1>
                  <p className="mt-3 text-base leading-relaxed text-navy/70">
                    {t(me.prefs_ready ? "answers.introEdit" : "answers.intro")}
                  </p>
                  <p className="mt-4 text-sm font-medium text-navy/80">{t("q.private")}</p>
                </header>
              }
              onSaved={async () => {
                autoPlan.current = true;
                setInviting(false);
                setSavedNote(true);
                try {
                  await clearPlans(); // plans made before these answers are stale; remade once everyone is ready
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
                await load();
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

        {stage === "lobby" && me?.prefs_ready && !inviting && (
          <Waiting members={members} me={me} busy={!!busy} saved={savedNote} onMakePlans={askGrok} onOpenAnswers={openAnswers} onInvite={() => setInviting(true)} />
        )}

        {((stage === "lobby" && (!me?.prefs_ready || inviting)) || (stage === "vote" && inviting)) && (
          <>
            {inviting && (
              <div className="mx-auto mb-6 w-full max-w-3xl">
                <button onClick={() => setInviting(false)} className="text-sm font-semibold text-navy underline underline-offset-4">
                  {t("waiting.doneInviting")}
                </button>
              </div>
            )}
            <Lobby group={group} members={members} me={me} busy={!!busy} saved={savedNote} onAskGrok={askGrok} onOpenAnswers={openAnswers} />
          </>
        )}

        {grokRun && (
          <div className="mb-10">
            <GrokWorking key={grokRun.startedAt} run={grokRun} isMine={grokRun === myRun} onDone={dismissGrokRun} />
          </div>
        )}

        {stage === "vote" && !inviting && (
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
                {me?.is_organizer ? t("board.tieCreator") : tNodes("board.tieWaiting", { name: iso(organizer?.display_name ?? t("common.theCreator")) })}
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {me?.is_organizer && (
                <button
                  disabled={!!busy}
                  onClick={askGrok}
                  className="q-btn q-btn-secondary text-sm"
                >
                  {t("board.askAgain")}
                </button>
              )}
              {me && (
                <button onClick={openAnswers} className="inline-flex min-h-10 items-center text-sm font-semibold text-navy underline underline-offset-4">
                  {t("lobby.editAnswers")}
                </button>
              )}
              {me && !isClosed(group) && (
                <button onClick={() => setInviting(true)} className="inline-flex min-h-10 items-center text-sm font-semibold text-navy underline underline-offset-4">
                  {t("waiting.inviteMore")}
                </button>
              )}
            </div>
          </section>
        )}

        {stage === "final" && winner && (
          <FinalPlan
            group={group}
            plan={winner}
            members={members}
            painting={painting}
            onMakePoster={me ? makePoster : undefined}
            posterFailed={posterFailed}
          />
        )}

        {info && <div className="q-alert q-alert-info mt-6 max-w-xl">{info}</div>}
        {err && <div role="alert" className="q-alert q-alert-error mt-6 max-w-xl">{err}</div>}
        </div>
      </div>
    </div>
  );
}
