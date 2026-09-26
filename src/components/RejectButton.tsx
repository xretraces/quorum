// Reject a plan with a reason. Stored on members.constraints.rejection so every phone sees it live
// (members is in the Realtime publication), and posted to the chat so it lands in the next Grok transcript.
import { useState } from "react";
import { type Member, type Plan, supabase } from "../lib/supabase";

export const TOO_EXPENSIVE = "Too expensive";
const REASONS = [TOO_EXPENSIVE, "Timing doesn't work", "Not my thing"];

export function RejectButton({ me, plan, disabled }: { me: Member; plan: Plan; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reject(reason: string) {
    setErr(null);
    const rejection = { plan_id: plan.id, reason, at: new Date().toISOString() };
    const { error } = await supabase
      .from("members")
      .update({ constraints: { ...(me.constraints ?? {}), rejection }, approved: false, vote_plan_id: null })
      .eq("id", me.id);
    if (error) return setErr(error.message);
    await supabase.from("messages").insert({
      group_id: me.group_id, member_id: me.id, sender_name: me.display_name,
      text: `❌ Rejected "${plan.title}": ${reason}`,
    });
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        Reject
      </button>
    );
  }
  return (
    <div className="flex w-full flex-wrap gap-2 rounded-lg bg-red-50 p-2">
      <span className="w-full text-xs font-semibold text-red-700">Why?</span>
      {REASONS.map((r) => (
        <button key={r} onClick={() => reject(r)} className="rounded-lg bg-white px-3 py-1 text-sm text-red-700 shadow-sm hover:bg-red-100">
          {r}
        </button>
      ))}
      <button onClick={() => setOpen(false)} className="px-2 text-sm text-gray-500">Cancel</button>
      {err && <p className="w-full text-xs text-red-600">{err}</p>}
    </div>
  );
}
