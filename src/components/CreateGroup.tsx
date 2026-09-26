// Home screen: organizer creates a group (then lands on the board, where the invite link is shown),
// or a friend enters an invite code and goes to /join/:code.
import { useState } from "react";
import { dollarsToCents, INVALID_BUDGET, setMyMemberId, supabase } from "../lib/supabase";
import { YourGroups } from "./YourGroups";

const input = "w-full rounded-lg border border-gray-300 p-3 focus:border-transparent focus:ring-2 focus:ring-indigo-500";

type Props = { onCreated: (groupId: string) => void; onJoinCode: (code: string) => void; onOpen: (groupId: string) => void };

export function CreateGroup({ onCreated, onJoinCode, onOpen }: Props) {
  const [groupName, setGroupName] = useState("Saturday hang");
  const [name, setName] = useState("");
  const [cap, setCap] = useState("30");
  const [dietary, setDietary] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const capCents = dollarsToCents(cap);
    if (capCents === null) return setErr(INVALID_BUDGET);
    setBusy(true);
    setErr(null);
    try {
      const { data: group, error } = await supabase.from("groups").insert({ name: groupName }).select().single();
      if (error) throw error;
      const { data: me, error: mErr } = await supabase
        .from("members")
        .insert({ group_id: group.id, display_name: name, is_organizer: true, budget_cap_cents: capCents, dietary: dietary || null })
        .select()
        .single();
      if (mErr) throw mErr;
      setMyMemberId(group.id, me.id);
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-indigo-50 to-white p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-indigo-600">Quorum</h1>
          <p className="mt-2 text-gray-600">Turn messy group chats into a plan everyone can pay for.</p>
        </div>

        <YourGroups onOpen={onOpen} />

        <form onSubmit={create} className="space-y-3 rounded-2xl bg-white p-6 shadow-lg">
          <h2 className="text-xl font-bold">Create Group</h2>
          <input className={input} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" required />
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
          <label className="block text-sm text-gray-700">
            Maximum spending per person ($)
            <input className={`${input} mt-1`} value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" placeholder="50" required />
          </label>
          <input className={input} value={dietary} onChange={(e) => setDietary(e.target.value)} placeholder="Dietary (optional, e.g. vegetarian)" />
          <button disabled={busy} className="w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Creating…" : "Create Group"}
          </button>
          {err && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
        </form>

        <form onSubmit={join} className="space-y-3 rounded-2xl bg-white p-6 shadow-lg">
          <h2 className="text-xl font-bold">Join Group</h2>
          <input className={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code or link" required />
          <button className="w-full rounded-xl border-2 border-indigo-600 p-3 font-semibold text-indigo-700 transition-colors hover:bg-indigo-50">
            Join Group
          </button>
        </form>
      </div>
    </div>
  );
}
