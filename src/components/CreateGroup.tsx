// Home screen: the creator makes a group (then lands in the lobby with the QR code and invite link),
// or a friend enters an invite code and goes to /join/:code.
import { useState } from "react";
import { useT } from "../i18n/hooks";
import { claimMember } from "../lib/prefs";
import { setMyMemberId, supabase } from "../lib/supabase";
import { HangMascots } from "./HangMascots";
import { QuorumHeader } from "./QuorumHeader";
import { YourGroups } from "./YourGroups";

const field = "q-input border-navy/40 bg-white/85 placeholder:text-navy/65 focus:bg-white";

type Props = { onCreated: (groupId: string) => void; onJoinCode: (code: string) => void; onOpen: (groupId: string) => void };

export function CreateGroup({ onCreated, onJoinCode, onOpen }: Props) {
  const t = useT();
  const [groupName, setGroupName] = useState(""); // always starts empty: no default, saved or URL-provided name
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      setErr(t("landing.groupNameRequired"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { data: group, error } = await supabase.from("groups").insert({ name: trimmedName }).select().single();
      if (error) throw error;
      const { data: me, error: mErr } = await supabase
        .from("members")
        .insert({ group_id: group.id, display_name: name, is_organizer: true })
        .select()
        .single();
      if (mErr) throw mErr;
      setMyMemberId(group.id, me.id);
      await claimMember(me.id).catch((e) => console.warn(e)); // retried when the questionnaire opens
      onCreated(group.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().replace(/^.*\/join\//, "");
    if (c) onJoinCode(c);
  }

  return (
    <div className="quorum-create relative flex min-h-dvh flex-col px-5 pt-[max(5.25rem,calc(env(safe-area-inset-top)+4.5rem))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8">
      <div className="absolute inset-x-0 top-0 z-10 px-5 pt-[max(1.15rem,env(safe-area-inset-top))] sm:px-8">
        <QuorumHeader showLogo tone="onSpring" />
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center space-y-10">
        <header className="text-center">
          <div className="relative mx-auto w-fit">
            <div className="absolute left-1/2 top-1/2 h-[130%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 blur-2xl" />
            <HangMascots className="relative mx-auto h-24 w-auto sm:h-28" />
          </div>
          <h1 className="font-logo mt-4 text-5xl font-semibold leading-[0.95] tracking-tight text-white sm:text-6xl">
            {t("landing.letsHang")}
          </h1>
          <p className="mx-auto mt-5 max-w-sm text-base leading-relaxed text-navy sm:text-lg">
            {t("landing.tagline")}
          </p>
        </header>

        <form onSubmit={create} className="space-y-3">
          <input
            className={field}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder={t("landing.groupNamePlaceholder")}
            aria-label={t("landing.groupNameLabel")}
            aria-invalid={err === t("landing.groupNameRequired") || undefined}
          />
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("common.yourName")}
            required
          />
          <button
            disabled={busy}
            className="q-btn q-btn-primary min-h-14 w-full text-lg"
          >
            {busy ? t("landing.creating") : t("landing.createButton")}
          </button>
          {err && <p role="alert" className="q-alert q-alert-error">{err}</p>}
        </form>

        <form onSubmit={join} className="space-y-3 text-center">
          <p className="text-sm font-semibold text-navy/80">{t("landing.haveCode")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className={field + " min-w-0 flex-1"}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("landing.codePlaceholder")}
              required
            />
            <button className="q-btn q-btn-dark px-6 sm:shrink-0">
              {t("landing.joinShort")}
            </button>
          </div>
        </form>

        <YourGroups onOpen={onOpen} />
      </div>
    </div>
  );
}
