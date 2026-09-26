// One plan option: items, estimated per-person cost, budget check per member, votes, reject.
import { type Member, overCapBy, type Plan, rejectionOf, usd } from "../lib/supabase";
import { GrokSays } from "./Grok";
import { RejectButton } from "./RejectButton";

type Props = {
  plan: Plan;
  members: Member[];
  me: Member | undefined;
  onVote: () => void;
  onLock: () => void;
  busy: boolean;
};

export function PlanCard({ plan, members, me, onVote, onLock, busy }: Props) {
  const votes = members.filter((m) => m.vote_plan_id === plan.id);
  const rejections = members.flatMap((m) => {
    const r = rejectionOf(m, [plan.id]);
    return r ? [{ member: m, ...r }] : [];
  });
  const isMyVote = me?.vote_plan_id === plan.id;
  const noteFor = (m: Member) => plan.member_notes.find((n) => n.member_id === m.id || n.name === m.display_name)?.note;

  return (
    <article className={`space-y-3 rounded-2xl bg-white p-4 shadow-md ${isMyVote ? "ring-2 ring-indigo-500" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold text-gray-900">{plan.title}</h3>
        <div className="shrink-0 text-right">
          <div className="text-xl font-bold text-indigo-600">{usd(plan.per_person_cents)}</div>
          <div className="text-xs text-gray-500">estimated / person</div>
        </div>
      </div>

      {plan.summary && <p className="text-sm text-gray-600">{plan.summary}</p>}

      <ol className="list-decimal space-y-1 pl-5">
        {plan.items.map((it, i) => (
          <li key={i} className="text-sm">
            <span className="text-gray-500">{it.start_time}:</span> <span className="font-medium">{it.name}</span>{" "}
            <span className="text-gray-500">(~{usd(it.price_per_person_cents)})</span>
            {it.note && <span className="text-gray-400"> · {it.note}</span>}
          </li>
        ))}
      </ol>
      <p className="text-xs text-gray-400">Estimated total {usd(plan.total_cents)} · prices are approximate demo data</p>

      {plan.why_it_works && (
        <GrokSays label="why this works" className="rounded-xl bg-indigo-50 p-3">
          {plan.why_it_works}
        </GrokSays>
      )}

      <div className="border-t border-gray-100 pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Budget check</p>
        <ul className="space-y-1.5">
          {members.map((m) => {
            const over = overCapBy(plan.per_person_cents, m.budget_cap_cents);
            const note = noteFor(m);
            return (
              <li key={m.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{m.display_name}</span>
                  <span className={over === null ? "text-gray-500" : over > 0 ? "font-semibold text-amber-600" : "text-emerald-600"}>
                    {usd(plan.per_person_cents)} / {usd(m.budget_cap_cents)}{" "}
                    {over === null ? "· no cap" : over > 0 ? `⚠ ${usd(over)} over` : "✓"}
                  </span>
                </div>
                {note && <p className="text-xs text-gray-500">{note}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      {plan.server_warnings.length > 0 && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-700">Checked by server: {plan.server_warnings.join(" ")}</p>
      )}

      {rejections.map((r) => (
        <p key={r.member.id} className="rounded bg-red-50 p-2 text-sm text-red-700">
          <b>{r.member.display_name}</b> rejected the plan. Reason: {r.reason}.
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          disabled={!me || busy}
          onClick={onVote}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
            isMyVote ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
          }`}
        >
          {isMyVote ? "✓ Approved" : "Approve"} ({votes.length}/{members.length})
        </button>
        {me && <RejectButton me={me} plan={plan} disabled={busy} />}
        {me?.is_organizer && (
          <button
            disabled={busy}
            onClick={onLock}
            className="ml-auto rounded-lg border-2 border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
          >
            🔒 Lock & collect
          </button>
        )}
      </div>
      {votes.length > 0 && <p className="text-xs text-gray-500">Approved by {votes.map((v) => v.display_name).join(", ")}</p>}
    </article>
  );
}
