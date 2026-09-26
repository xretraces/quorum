// src/components/PayButton.tsx: one member approves the locked plan and authorizes a HOLD on their card.
// Stripe TEST MODE: use card 4242 4242 4242 4242, any future expiry, any CVC, any ZIP.
// Nothing is charged until EVERY member has approved and authorized; then the `pay` function captures all holds.
import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { invoke, usd } from "../lib/supabase";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "pk_test_placeholder");

type HoldResult = {
  member_id: string;
  status: "held" | "needs_reapproval" | "no_payment_needed";
  client_secret?: string;
  pi_status?: string;
  amount_cents?: number;
  share_cents?: number;
  cap_cents?: number | null;
  reason?: "over_cap" | "no_cap";
};
type HoldResponse = { results: HoldResult[]; share_cents: number };
type ApproveResponse = { status: string; pending_approval?: string[]; pending_authorization?: string[] };

type Props = { groupId: string; memberId: string; planId: string; onChange?: () => void };

export function PayButton({ groupId, memberId, planId, onChange }: Props) {
  const [phase, setPhase] = useState<"idle" | "loading" | "reapprove" | "card" | "done">("idle");
  const [hold, setHold] = useState<HoldResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function approve(acceptAmountCents?: number) {
    const r = await invoke<ApproveResponse>("pay", {
      action: "approve", group_id: groupId, member_id: memberId, plan_id: planId, accept_amount_cents: acceptAmountCents,
    });
    if (r.status === "needs_reapproval") throw new Error("Re-approval required for this amount.");
    setMsg(
      r.status === "captured" ? "Everyone's in. All holds captured 🎉"
      : r.status === "waiting" ? `You're in ✔ Waiting on ${(r.pending_approval?.length ?? 0) + (r.pending_authorization?.length ?? 0)} more step(s) from the group.`
      : `Status: ${r.status}`,
    );
    onChange?.();
  }

  async function start() {
    setPhase("loading");
    setMsg(null);
    try {
      const r = await invoke<HoldResponse>("pay", { action: "hold", group_id: groupId, plan_id: planId, member_id: memberId });
      const mine = r.results[0];
      setHold(mine);
      if (mine.status === "needs_reapproval") return setPhase("reapprove");
      if (mine.status === "no_payment_needed") {
        await approve();
        return setPhase("done");
      }
      if (mine.pi_status === "requires_capture") { // already authorized earlier (e.g. page refresh)
        await approve();
        return setPhase("done");
      }
      setPhase("card");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  async function reapprove() {
    if (!hold?.share_cents) return;
    setPhase("loading");
    try {
      await approve(hold.share_cents); // explicit consent to the higher amount
      await start(); // now the hold can be created
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setPhase("reapprove");
    }
  }

  if (phase === "reapprove" && hold) {
    return (
      <div className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
        <p className="font-semibold text-amber-800">⚠ Budget Alert</p>
        <p className="text-sm text-amber-700">
          This plan is <b>{usd(hold.share_cents)}</b> per person
          {hold.reason === "over_cap" ? <>, which is above your <b>{usd(hold.cap_cents)}</b> cap.</> : <>, and you haven't set a cap.</>}
        </p>
        <p className="text-sm text-amber-700">Approve this amount?</p>
        <div className="flex gap-2">
          <button onClick={reapprove} className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700 transition-colors">
            Approve {usd(hold.share_cents)} anyway
          </button>
          <button onClick={() => setPhase("idle")} className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 transition-colors">
            No
          </button>
        </div>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </div>
    );
  }

  if (phase === "card" && hold?.client_secret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret: hold.client_secret, appearance: { theme: "stripe" } }}>
        <CardForm
          amountCents={hold.amount_cents ?? 0}
          onAuthorized={async () => {
            try {
              await approve();
              setPhase("done");
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e));
            }
          }}
        />
        {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      </Elements>
    );
  }

  return (
    <div className="space-y-2">
      {phase !== "done" && (
        <button onClick={start} disabled={phase === "loading"} className="w-full rounded-xl bg-emerald-600 p-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
          {phase === "loading" ? "One sec…" : "Approve & hold my share"}
        </button>
      )}
      {msg && <p className="text-sm text-center">{msg}</p>}
    </div>
  );
}

function CardForm({ amountCents, onAuthorized }: { amountCents: number; onAuthorized: () => Promise<void> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) {
      setErr(error.message ?? "Payment failed");
      setBusy(false);
      return;
    }
    if (paymentIntent?.status === "requires_capture" || paymentIntent?.status === "succeeded") {
      await onAuthorized();
    } else {
      setErr(`Unexpected status: ${paymentIntent?.status}`);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 p-4 bg-white">
      <PaymentElement />
      <button disabled={!stripe || busy} className="w-full rounded-xl bg-emerald-600 p-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
        {busy ? "Authorizing…" : `Hold ${usd(amountCents)} on my card`}
      </button>
      <p className="text-xs text-gray-500 text-center">
        Test mode: 4242 4242 4242 4242 · any future date · any CVC. Nothing is captured until everyone approves.
      </p>
      {err && <p className="text-sm text-red-600 text-center">{err}</p>}
    </form>
  );
}
