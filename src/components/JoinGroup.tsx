// src/components/JoinGroup.tsx: friend opens /join/:inviteCode and adds their constraints.
import { useEffect, useState } from "react";
import { dollarsToCents, type Group, INVALID_BUDGET, myMemberId, setMyMemberId, supabase } from "../lib/supabase";

export function JoinGroup({ inviteCode, onJoined }: { inviteCode: string; onJoined: (groupId: string) => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [cap, setCap] = useState("");
  const [dietary, setDietary] = useState("");
  const [availability, setAvailability] = useState("");
  const [transport, setTransport] = useState("transit");
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
    const capCents = dollarsToCents(cap);
    if (capCents === null) return setErr(INVALID_BUDGET);
    setErr(null);
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("members")
        .insert({
          group_id: group.id,
          display_name: name,
          budget_cap_cents: capCents,
          dietary: dietary || null,
          availability: availability || null,
          transport,
        })
        .select()
        .single();
      if (error) {
        setErr(error.code === "23505" ? "Someone in this group already has that name." : error.message);
        return;
      }
      setMyMemberId(group.id, data.id);
      onJoined(group.id);
    } finally {
      setBusy(false);
    }
  }

  if (!group) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white flex items-center justify-center p-4">
        <p className="text-gray-600">{err ?? "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white flex items-center justify-center p-4">
      <form onSubmit={join} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-lg">
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold text-indigo-600">Quorum</h1>
        </div>
        <h2 className="text-xl font-bold">Join "{group.name}"</h2>
        <input 
          className="w-full rounded-lg border border-gray-300 p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
          value={name} 
          onChange={(e) => setName(e.target.value)} 
          placeholder="Your name" 
          required 
        />
        <label className="block text-sm">
          <span className="text-gray-700">Max I'll spend per person ($)</span>
          <span className="block text-xs text-gray-500 mt-1">Your card will never be charged more without asking you.</span>
          <input 
            className="w-full rounded-lg border border-gray-300 p-3 mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
            value={cap} 
            onChange={(e) => setCap(e.target.value)} 
            inputMode="decimal" 
            required 
          />
        </label>
        <input 
          className="w-full rounded-lg border border-gray-300 p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
          value={dietary} 
          onChange={(e) => setDietary(e.target.value)} 
          placeholder="Dietary (e.g. vegetarian)" 
        />
        <input 
          className="w-full rounded-lg border border-gray-300 p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
          value={availability} 
          onChange={(e) => setAvailability(e.target.value)} 
          placeholder="When are you free? (e.g. Sat after 2pm)" 
        />
        <select 
          className="w-full rounded-lg border border-gray-300 p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
          value={transport} 
          onChange={(e) => setTransport(e.target.value)}
        >
          <option value="transit">MARTA / transit</option>
          <option value="car">I have a car</option>
          <option value="rideshare">Rideshare</option>
          <option value="walk_bike">Walk / bike</option>
        </select>
        <button 
          disabled={busy}
          className="w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {busy ? "Joining…" : "Join Group"}
        </button>
        {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}
      </form>
    </div>
  );
}
