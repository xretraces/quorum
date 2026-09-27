// src/components/JoinGroup.tsx: a friend scans the QR / opens /join/:inviteCode and joins with a display name.
// Their preferences are asked privately in the lobby (Questionnaire), not here.
import { useEffect, useState } from "react";
import { claimMember } from "../lib/prefs";
import { type Group, myMemberId, setMyMemberId, supabase } from "../lib/supabase";

export function JoinGroup({ inviteCode, onJoined }: { inviteCode: string; onJoined: (groupId: string) => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("groups").select("*").eq("invite_code", inviteCode).maybeSingle().then(({ data, error }) => {
      if (error) setErr(error.message);
      else if (!data) setErr("Group not found. Please check the group code.");
      else {
        setGroup(data as Group);
        if (myMemberId(data.id)) onJoined(data.id); // already joined on this device
      }
    });
  }, [inviteCode, onJoined]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!group) return;
    setErr(null);
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("members")
        .insert({ group_id: group.id, display_name: name.trim() })
        .select()
        .single();
      if (error) {
        setErr(error.code === "23505" ? "Someone in this group already has that name." : error.message);
        return;
      }
      setMyMemberId(group.id, data.id);
      await claimMember(data.id).catch((e) => console.warn(e)); // retried when the questionnaire opens
      onJoined(group.id);
    } finally {
      setBusy(false);
    }
  }

  if (!group) {
    return (
      <div className="quorum-inner relative isolate flex min-h-dvh items-center justify-center p-4">
        <p className="relative z-10 text-gray-600">{err ?? "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="quorum-inner relative isolate flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={join} className="relative z-10 w-full max-w-md space-y-4 rounded-3xl bg-white/90 p-6 shadow-lg ring-1 ring-spring/20">
        <p className="font-logo text-center text-2xl font-semibold tracking-tight text-spring-deep lowercase">quorum</p>
        <h1 className="text-xl font-bold text-gray-900">Join "{group.name}"</h1>
        <input
          className="w-full rounded-lg border border-gray-300 p-3 text-base focus:border-spring focus:outline-none focus:ring-2 focus:ring-spring/40"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          autoFocus
          required
        />
        <button disabled={busy} className="w-full rounded-xl bg-spring-deep p-3 font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-50">
          {busy ? "Joining…" : "Join"}
        </button>
        <p className="text-center text-xs text-gray-500">Next you'll answer a few private questions. Only Grok sees them.</p>
        {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      </form>
    </div>
  );
}
