// src/components/JoinGroup.tsx: a friend scans the QR / opens /join/:inviteCode and joins with a display name.
// A new member lands on their private answers page (/g/:id/answers); a returning one goes to the lobby.
import { useCallback, useEffect, useState } from "react";
import { iso, isoText } from "../i18n/bidi";
import { useT, useTNodes } from "../i18n/hooks";
import { isClosed } from "../lib/invite";
import { claimMember } from "../lib/prefs";
import { QuorumHeader } from "./QuorumHeader";
import { type Group, myMemberId, setMyMemberId, supabase } from "../lib/supabase";

type Load = "loading" | "ok" | "not-found" | "offline";

export function JoinGroup({ inviteCode, onJoined }: { inviteCode: string; onJoined: (groupId: string, fresh: boolean) => void }) {
  const t = useT();
  const tNodes = useTNodes();
  const [group, setGroup] = useState<Group | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchGroup = useCallback(() => {
    setLoad("loading");
    supabase.from("groups").select("*").eq("invite_code", inviteCode.trim()).maybeSingle().then(({ data, error }) => {
      if (error) return setLoad("offline");
      if (!data) return setLoad("not-found");
      if (myMemberId(data.id)) return onJoined(data.id, false); // already joined on this device: resume in the lobby
      setGroup(data as Group);
      setLoad("ok");
    });
  }, [inviteCode, onJoined]);

  useEffect(fetchGroup, [fetchGroup]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!group || busy) return;
    const displayName = name.trim();
    if (!displayName) return setErr(t("join.enterName"));
    setErr(null);
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("members")
        .insert({ group_id: group.id, display_name: displayName })
        .select()
        .single();
      if (error) {
        setErr(
          error.code === "23505"
            ? t("join.duplicateName", { name: isoText(displayName) })
            : t("join.failed", { error: error.message }),
        );
        return;
      }
      setMyMemberId(group.id, data.id);
      await claimMember(data.id).catch((e) => console.warn(e)); // retried when the questionnaire opens
      onJoined(group.id, true);
    } catch (e) {
      setErr(t("join.failedNetwork", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  const chrome = (
    <div className="relative z-20 bg-spring-deep px-5 pt-[max(1.15rem,env(safe-area-inset-top))] pb-4 sm:px-8">
      <QuorumHeader showLogo tone="onSpring" />
    </div>
  );

  if (load !== "ok" || !group) {
    const msg = {
      loading: t("common.loading"),
      "not-found": t("join.notFound"),
      offline: t("join.offline"),
      ok: t("common.loading"),
    }[load];
    return (
      <div className="quorum-inner relative isolate min-h-dvh">
        {chrome}
        <div className="relative z-10 px-5 pt-8 sm:px-8">
          <p className={`max-w-md text-navy/70 ${load === "loading" ? "motion-safe:animate-pulse" : ""}`}>{msg}</p>
          {load === "offline" && (
            <button onClick={fetchGroup} className="q-btn q-btn-dark mt-4">{t("common.tryAgain")}</button>
          )}
          {load !== "loading" && <a href="/" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-navy underline underline-offset-4">{t("join.goHome")}</a>}
        </div>
      </div>
    );
  }

  if (isClosed(group)) {
    return (
      <div className="quorum-inner relative isolate min-h-dvh">
        {chrome}
        <div className="relative z-10 px-5 pt-8 sm:px-8">
          <a href="/" className="inline-flex items-center text-2xl leading-none text-navy/70 hover:text-navy">
            <span className="rtl:-scale-x-100">←</span>
          </a>
          <div className="mt-8 max-w-xl">
            <h1 className="font-logo text-4xl font-bold tracking-tight text-navy">{tNodes("join.closedTitle", { group: iso(group.name) })}</h1>
            <p className="q-muted mt-3">{t("join.closedBody")}</p>
            <button onClick={() => onJoined(group.id, false)} className="q-btn q-btn-primary mt-6">
              {t("join.seePlan")}
            </button>
            <a href="/" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-navy underline underline-offset-4">{t("join.startOwn")}</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="quorum-inner relative isolate min-h-dvh">
      {chrome}
      <div className="relative z-10 px-5 pt-5 sm:px-8">
        <a href="/" className="inline-flex items-center text-2xl leading-none text-navy/70 hover:text-navy">
          <span className="rtl:-scale-x-100">←</span>
        </a>
      </div>
      <form onSubmit={join} className="relative z-10 mx-auto w-full max-w-[40rem] space-y-3 px-5 pb-16 pt-4 sm:px-8">
        <header className="q-paper">
          <h1 className="font-logo text-3xl font-bold tracking-tight text-navy sm:text-4xl">{tNodes("join.title", { group: iso(group.name) })}</h1>
          <p className="mt-3 text-sm text-navy/65">
            {group.status === "voting" ? t("join.votingHint") : t("join.nextHint")}
          </p>
        </header>
        <label className="q-paper q-label block font-medium">
          {t("common.yourName")}
          <input
            className="q-form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("common.yourName")}
            maxLength={40}
            autoComplete="given-name"
            enterKeyHint="go"
            autoFocus
            required
          />
        </label>
        <div className="pt-2">
          <button disabled={busy} className="q-btn q-btn-primary">
            {busy ? t("join.joining") : t("join.join")}
          </button>
        </div>
        {err && <p role="alert" className="q-alert q-alert-error">{err}</p>}
      </form>
    </div>
  );
}
