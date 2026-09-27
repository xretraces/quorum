// src/components/JoinGroup.tsx: a friend scans the QR / opens /join/:inviteCode and joins with a display name.
// Their preferences are asked privately in the lobby (Questionnaire), not here.
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/hooks";
import { isClosed } from "../lib/invite";
import { claimMember } from "../lib/prefs";
import { QuorumHeader } from "./QuorumHeader";
import { type Group, myMemberId, setMyMemberId, supabase } from "../lib/supabase";

type Load = "loading" | "ok" | "not-found" | "offline";

export function JoinGroup({ inviteCode, onJoined }: { inviteCode: string; onJoined: (groupId: string) => void }) {
  const t = useT();
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
      if (myMemberId(data.id)) return onJoined(data.id); // already joined on this device: resume
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
            ? t("join.duplicateName", { name: displayName })
            : t("join.failed", { error: error.message }),
        );
        return;
      }
      setMyMemberId(group.id, data.id);
      await claimMember(data.id).catch((e) => console.warn(e)); // retried when the questionnaire opens
      onJoined(group.id);
    } catch (e) {
      setErr(t("join.failedNetwork", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  if (load !== "ok" || !group) {
    const msg = {
      loading: t("common.loading"),
      "not-found": t("join.notFound"),
      offline: t("join.offline"),
      ok: t("common.loading"),
    }[load];
    return (
      <div className="quorum-inner relative isolate flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="absolute inset-x-0 top-0 z-20 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <QuorumHeader tone="onLight" />
        </div>
        <p className="relative z-10 max-w-md text-gray-600">{msg}</p>
        {load === "offline" && (
          <button onClick={fetchGroup} className="relative z-10 min-h-11 rounded-xl bg-navy px-5 font-semibold text-white">{t("common.tryAgain")}</button>
        )}
        {load !== "loading" && <a href="/" className="relative z-10 inline-flex min-h-11 items-center text-navy underline">{t("join.goHome")}</a>}
      </div>
    );
  }

  if (isClosed(group)) {
    return (
      <div className="quorum-inner relative isolate flex min-h-dvh items-center justify-center p-4">
        <div className="absolute inset-x-0 top-0 z-20 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <QuorumHeader tone="onLight" />
        </div>
        <div className="relative z-10 w-full max-w-md space-y-4 rounded-3xl bg-white/90 p-6 text-center shadow-lg ring-1 ring-spring/20">
          <p className="font-logo text-2xl font-semibold tracking-tight text-spring-deep lowercase">quorum</p>
          <h1 className="text-xl font-bold">{t("join.closedTitle", { group: group.name })}</h1>
          <p className="text-sm text-gray-600">{t("join.closedBody")}</p>
          <button onClick={() => onJoined(group.id)} className="w-full rounded-xl bg-navy p-3 font-semibold text-white hover:brightness-95">
            {t("join.seePlan")}
          </button>
          <a href="/" className="inline-flex min-h-11 items-center text-sm text-navy underline">{t("join.startOwn")}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="quorum-inner relative isolate flex min-h-dvh items-center justify-center p-4">
      <div className="absolute inset-x-0 top-0 z-20 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <QuorumHeader tone="onLight" />
      </div>
      <form onSubmit={join} className="relative z-10 w-full max-w-md space-y-4 rounded-3xl bg-white/90 p-6 shadow-lg ring-1 ring-spring/20">
        <p className="font-logo text-center text-2xl font-semibold tracking-tight text-spring-deep lowercase">quorum</p>
        <h1 className="text-xl font-bold text-gray-900">{t("join.title", { group: group.name })}</h1>
        <input
          className="w-full rounded-lg border border-gray-300 p-3 text-base focus:border-spring focus:outline-none focus:ring-2 focus:ring-spring/40"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("common.yourName")}
          maxLength={40}
          autoComplete="given-name"
          enterKeyHint="go"
          autoFocus
          required
        />
        <button disabled={busy} className="w-full rounded-xl bg-navy p-3 font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-50">
          {busy ? t("join.joining") : t("join.join")}
        </button>
        <p className="text-center text-xs text-gray-500">
          {group.status === "voting" ? t("join.votingHint") : t("join.nextHint")}
        </p>
        {err && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      </form>
    </div>
  );
}
