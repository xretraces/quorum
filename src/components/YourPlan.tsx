// "Your plan": this device's member only (pp:member:<groupId>). Their share vs. cap, the itinerary with travel
// legs for their transport, diet notes that apply to them, and a share/copy button.
import { useState } from "react";
import {
  bookingRef, dietNotesFor, dietOf, holdOf, legBetween, MODE, parseStart, payState, transportOf,
} from "../lib/booking";
import { type Member, type Payment, type Plan, type SimReason, usd } from "../lib/supabase";
import { CardLabel } from "./CardLabel";
import { DemoPlanPill, QuorumSays } from "./Grok";

type Props = { groupId: string; plan: Plan; me: Member; payments: Payment[]; simulated: SimReason | null };

export function YourPlan({ groupId, plan, me, payments, simulated }: Props) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const hold = holdOf(me, plan, payments, simulated);
  const share = hold.amount_cents;
  const state = payState(plan, hold.status);
  const cap = me.budget_cap_cents;
  const left = cap === null ? null : cap - share;
  const mode = transportOf(me);
  const diet = dietOf(me);
  const dietNotes = dietNotesFor(me, plan);
  const grokNote = plan.member_notes.find((n) => n.member_id === me.id || n.name === me.display_name)?.note;

  function planText() {
    const lines = [
      `My Quorum plan: ${plan.title}`,
      `My share: ${usd(share)} (${state.label.toLowerCase()})` +
        (cap === null ? "" : left! >= 0 ? `, ${usd(left)} left of my ${usd(cap)} cap` : `, ${usd(-left!)} over my ${usd(cap)} cap`),
      "",
    ];
    plan.items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.start_time}: ${it.name} (ref ${bookingRef(groupId, i)})`);
      const next = plan.items[i + 1];
      if (next) {
        const leg = legBetween(it, next, mode);
        lines.push(`   → ${leg.label}${leg.from && leg.to && leg.from !== leg.to ? ` (${leg.from} to ${leg.to})` : ""}${leg.detail ? `. ${leg.detail}` : ""}`);
      }
    });
    if (diet.length) lines.push("", `Diet: ${diet.join(", ")}`, ...dietNotes.map((d) => `- ${d.stop}: ${d.note}`));
    lines.push("", "Demo confirmation from Quorum, not a real reservation.");
    return lines.join("\n");
  }

  async function sharePlan() {
    const text = planText();
    if (navigator.share) {
      try {
        await navigator.share({ title: `My plan: ${plan.title}`, text });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    setCopied((await copyText(text)) ? "copied" : "failed");
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <section className="space-y-4 rounded-2xl bg-white p-4 shadow-md">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-gray-900">Your plan</h2>
        <span className="text-xs text-gray-400">Only on your phone</span>
      </div>

      <div className="rounded-2xl bg-indigo-600 p-4 text-white">
        <span className="inline-block rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">
          {state.icon} {state.label}
        </span>
        <p className="mt-2 text-4xl font-bold tracking-tight">{usd(share)}</p>
        <p className="text-sm text-indigo-100">Your share of {usd(plan.total_cents)}</p>
        {hold.card && <CardLabel card={hold.card} className="mt-1.5 text-indigo-100" />}
        {cap !== null && (
          <>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
              <div
                className={`h-full rounded-full ${left! >= 0 ? "bg-white" : "bg-amber-300"}`}
                style={{ width: `${cap === 0 ? 100 : Math.min(100, (share / cap) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-sm">
              {left! >= 0 ? (
                <><b>{usd(left)}</b> left of your {usd(cap)} cap</>
              ) : (
                <><b>{usd(-left!)}</b> over your {usd(cap)} cap (you approved it)</>
              )}
            </p>
          </>
        )}
        {cap === null && <p className="mt-2 text-sm text-indigo-100">No spending cap set</p>}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Itinerary</h3>
          <span className="text-xs text-gray-500">
            {MODE[mode].icon} {MODE[mode].you}
          </span>
        </div>
        <ol>
          {plan.items.map((it, i) => {
            const t = parseStart(it.start_time);
            const next = plan.items[i + 1];
            const leg = next ? legBetween(it, next, mode) : null;
            return (
              <li key={i}>
                <div className="flex gap-3">
                  <div className="w-16 shrink-0 pt-0.5 text-right">
                    {t.day && <div className="text-[11px] font-semibold uppercase text-rose-500">{t.day}</div>}
                    <div className="text-sm font-bold leading-tight text-gray-900">{t.time}</div>
                  </div>
                  <div className="relative flex flex-col items-center">
                    <span className="mt-1 h-3 w-3 rounded-full border-2 border-indigo-600 bg-white" />
                    {leg && <span className="w-0.5 flex-1 bg-indigo-100" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-3">
                    <p className="font-semibold text-gray-900">{it.name}</p>
                    {it.note && <p className="text-xs text-gray-500">{it.note}</p>}
                    <p className="mt-0.5 font-mono text-[11px] text-gray-400">Ref {bookingRef(groupId, i)}</p>
                  </div>
                </div>
                {leg && (
                  <div className="flex gap-3">
                    <div className="w-16 shrink-0" />
                    <div className="flex w-3 justify-center">
                      <span className="w-0.5 border-l-2 border-dashed border-indigo-200" />
                    </div>
                    <div className="mb-3 min-w-0 flex-1 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <p>
                        <span className="mr-1">{leg.icon}</span>
                        <b className="text-gray-800">{leg.label}</b>
                        {leg.from && leg.to && leg.from !== leg.to && <> · {leg.from} → {leg.to}</>}
                      </p>
                      {leg.detail && <p className="mt-0.5 text-gray-500">{leg.detail}</p>}
                      {leg.gapMinutes !== null && <p className="mt-0.5 text-gray-500">About {leg.gapMinutes} min between stops</p>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {diet.length > 0 && (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-800">🥗 Diet: {diet.join(", ")}</p>
          {dietNotes.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-emerald-900">
              {dietNotes.map((d, i) => (
                <li key={i} className={d.ok ? "" : "text-amber-700"}>
                  {d.ok ? "✓" : "⚠"} {d.stop}: {d.note}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-emerald-900">No food stops on this plan need a diet check.</p>
          )}
        </div>
      )}

      {grokNote && (
        <QuorumSays label="why it works for you" tag={plan.model === "demo-fallback" && <DemoPlanPill />} className="rounded-xl bg-indigo-50 p-3">
          {grokNote}
        </QuorumSays>
      )}

      <button
        onClick={sharePlan}
        className="w-full rounded-xl bg-gray-900 p-3 font-semibold text-white transition-colors hover:bg-gray-800 active:bg-gray-700"
      >
        {copied === "copied" ? "✓ Copied to clipboard" : copied === "failed" ? "Couldn't copy. Try again" : "📤 Share / copy my plan"}
      </button>
    </section>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // navigator.clipboard needs a secure context; phones on the LAN dev URL (http://192.168…) don't have one.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
