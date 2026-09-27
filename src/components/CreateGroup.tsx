// Home screen: the creator makes a group (then lands in the lobby with the QR code and invite link),
// or a friend enters an invite code and goes to /join/:code.
import { useState } from "react";
import { claimMember } from "../lib/prefs";
import { setMyMemberId, supabase } from "../lib/supabase";
import { HangMascots } from "./HangMascots";
import { YourGroups } from "./YourGroups";

const field =
  "min-h-12 w-full rounded-lg border-2 border-navy/35 bg-white/70 px-4 py-3.5 text-base text-navy placeholder:text-navy/45 focus:border-navy focus:bg-white focus:outline-none";

const utilBtn =
  "inline-flex h-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white";

type Props = { onCreated: (groupId: string) => void; onJoinCode: (code: string) => void; onOpen: (groupId: string) => void };

export function CreateGroup({ onCreated, onJoinCode, onOpen }: Props) {
  const [groupName, setGroupName] = useState("Saturday hang");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { data: group, error } = await supabase.from("groups").insert({ name: groupName }).select().single();
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
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-[max(1.15rem,env(safe-area-inset-top))] sm:px-8">
        <p className="font-logo text-2xl font-semibold tracking-tight text-white lowercase sm:text-3xl">
          quorum
        </p>
        <nav className="flex items-center gap-0.5 rounded-full border border-white/40 bg-white/15 py-1 pl-1.5 pr-1 backdrop-blur-sm" aria-hidden="true">
          <button type="button" tabIndex={-1} className={`${utilBtn} gap-1 px-2.5 text-[13px] font-semibold tracking-wide`}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M3.5 12h17M12 3.5c2.3 2.8 3.4 5.7 3.4 8.5s-1.1 5.7-3.4 8.5c-2.3-2.8-3.4-5.7-3.4-8.5S9.7 6.3 12 3.5z" />
            </svg>
            EN
          </button>
          <span className="h-5 w-px bg-white/30" />
          <button type="button" tabIndex={-1} className={`${utilBtn} w-8`} aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 10a6 6 0 1 1 12 0c0 4.5 1.5 5.5 2.5 6.5h-17C4.5 15.5 6 14.5 6 10z" />
              <path d="M10 20a2.2 2.2 0 0 0 4 0" />
            </svg>
          </button>
          <span className="h-5 w-px bg-white/30" />
          <button type="button" tabIndex={-1} className={`${utilBtn} w-8`} aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 11v5" />
              <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </nav>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center space-y-10">
        <header className="text-center">
          <div className="relative mx-auto w-fit">
            <div className="absolute left-1/2 top-1/2 h-[130%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 blur-2xl" />
            <HangMascots className="relative mx-auto h-24 w-auto sm:h-28" />
          </div>
          <h1 className="font-logo mt-4 text-5xl font-semibold leading-[0.95] tracking-tight text-white sm:text-6xl">
            Let’s hang.
          </h1>
          <p className="mx-auto mt-5 max-w-sm text-base leading-relaxed text-white/90 sm:text-lg">
            Everyone answers privately. Quorum finds a plan that works for everyone.
          </p>
        </header>

        <form onSubmit={create} className="space-y-3">
          <input className={field} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" required />
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
          <button
            disabled={busy}
            className="min-h-14 w-full rounded-md bg-sun px-8 text-lg font-semibold text-navy transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create Group"}
          </button>
          {err && <p className="text-center text-sm font-medium text-red-800">{err}</p>}
        </form>

        <form onSubmit={join} className="space-y-3 text-center">
          <p className="text-sm font-semibold text-navy/80">Already have a code?</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className={field + " min-w-0 flex-1"}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Invite code or link"
              required
            />
            <button className="min-h-12 rounded-md border-2 border-navy bg-white/80 px-6 py-3 text-base font-semibold text-navy transition-colors hover:bg-white sm:shrink-0">
              Join
            </button>
          </div>
        </form>

        <YourGroups onOpen={onOpen} />
      </div>
    </div>
  );
}
