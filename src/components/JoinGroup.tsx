// src/components/JoinGroup.tsx: a friend scans the QR / opens /join/:inviteCode and joins with a display name.
// Their preferences are asked privately in the lobby (Questionnaire), not here.
import { useCallback, useEffect, useState } from "react";
import { isClosed } from "../lib/invite";
import { claimMember } from "../lib/prefs";
import { type Group, myMemberId, setMyMemberId, supabase } from "../lib/supabase";

type Load = "loading" | "ok" | "not-found" | "offline";

export function JoinGroup({ inviteCode, onJoined }: { inviteCode: string; onJoined: (groupId: string) => void }) {
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
    if (!displayName) return setErr("Please enter your name.");
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
            ? `"${displayName}" already joined this group. If that's you on another device, keep using that device (your answers live there), or join here with a different name.`
            : `Couldn't join: ${error.message}`,
        );
        return;
      }
      setMyMemberId(group.id, data.id);
      await claimMember(data.id).catch((e) => console.warn(e)); // retried when the questionnaire opens
      onJoined(group.id);
    } catch (e) {
      setErr(`Couldn't join. Check your connection and try again. (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      setBusy(false);
    }
  }

  if (load !== "ok" || !group) {
    const msg = {
      loading: "Loading…",
      "not-found": "We couldn't find that group. The invite link may be incomplete. Ask your friend to share it again.",
      offline: "Couldn't reach Quorum. Check your connection and try again.",
      ok: "Loading…",
    }[load];
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gradient-to-b from-indigo-50 to-white p-4 text-center">
        <p className="max-w-md text-gray-600">{msg}</p>
        {load === "offline" && (
          <button onClick={fetchGroup} className="min-h-11 rounded-xl bg-indigo-600 px-5 font-semibold text-white">Try again</button>
        )}
        {load !== "loading" && <a href="/" className="inline-flex min-h-11 items-center text-indigo-600 underline">Go to Quorum</a>}
      </div>
    );
  }

  if (isClosed(group)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-indigo-50 to-white p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-center shadow-lg">
          <p className="text-2xl font-bold text-indigo-600">Quorum</p>
          <h1 className="text-xl font-bold">"{group.name}" already picked its plan</h1>
          <p className="text-sm text-gray-600">This group isn't taking new people, but you can still see what they chose.</p>
          <button onClick={() => onJoined(group.id)} className="w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white hover:bg-indigo-700">
            See the plan
          </button>
          <a href="/" className="inline-flex min-h-11 items-center text-sm text-indigo-600 underline">Start your own group</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-indigo-50 to-white p-4">
      <form onSubmit={join} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-lg">
        <p className="text-center text-2xl font-bold text-indigo-600">Quorum</p>
        <h1 className="text-xl font-bold">Join "{group.name}"</h1>
        <input
          className="w-full rounded-lg border border-gray-300 p-3 text-base focus:border-transparent focus:ring-2 focus:ring-indigo-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          autoComplete="given-name"
          enterKeyHint="go"
          autoFocus
          required
        />
        <button disabled={busy} className="w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "Joining…" : "Join"}
        </button>
        <p className="text-center text-xs text-gray-500">
          {group.status === "voting" ? "Plans are already out. Join to vote on them." : "Next you'll answer a few private questions. Only Grok sees them."}
        </p>
        {err && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      </form>
    </div>
  );
}
