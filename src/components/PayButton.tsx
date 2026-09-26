// src/components/PayButton.tsx: one member approves the locked plan and authorizes a HOLD on their card.
// Stripe TEST MODE: use card 4242 4242 4242 4242, any future expiry, any CVC, any ZIP.
// Nothing is charged until EVERY member has approved and authorized; then the `pay` function captures all holds.
// Simulated mode (lib/payments.ts) walks the same steps without Stripe: the card form becomes one button.
import { useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type SimReason, usd } from "../lib/supabase";
import {
  type Fallback,
  type HoldResult,
  memberApprove,
  memberHold,
  simAuthorize,
  STRIPE_PUBLISHABLE_KEY,
} from "../lib/payments";

let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = () => (stripePromise ??= loadStripe(STRIPE_PUBLISHABLE_KEY));

type Props = {
  groupId: string;
  memberId: string;
  planId: string;
  simulated: SimReason | null;
  onChange?: () => void;
  onFallback?: (f: Fallback) => void;
};

export function PayButton({ groupId, memberId, planId, simulated, onChange, onFallback }: Props) {
  const [phase, setPhase] = useState<"idle" | "loading" | "reapprove" | "card" | "done">("idle");
  const [hold, setHold] = useState<HoldResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fellBack, setFellBack] = useState<SimReason | null>(null);
  const fellBackRef = useRef<SimReason | null>(null); // read synchronously by the next call in the same flow
  const sim = simulated ?? fellBack;
  const ctx = () => ({ groupId, memberId, planId, simulated: simulated ?? fellBackRef.current });

  function noteFallback(f: Fallback | null) {
    if (!f) return;
    fellBackRef.current = f.reason;
    setFellBack(f.reason);
    onFallback?.(f);
  }

  async function approve(acceptAmountCents?: number, authorized = false) {
    const { value: r, fallback } = await memberApprove(ctx(), acceptAmountCents, authorized);
    noteFallback(fallback);
    if (r.status === "needs_reapproval") throw new Error("Re-approval required for this amount.");
    setMsg(
      r.status === "captured" ? `Everyone's in. All ${ctx().simulated ? "simulated " : ""}holds captured 🎉`
      : r.status === "waiting" ? `You're in ✔ Waiting on ${(r.pending_approval?.length ?? 0) + (r.pending_authorization?.length ?? 0)} more step(s) from the group.`
      : `Status: ${r.status}`,
    );
    onChange?.();
  }

  async function start() {
    setPhase("loading");
    setMsg(null);
    try {
      const { value: r, fallback } = await memberHold(ctx());
      noteFallback(fallback);
      const mine = r.results[0];
      setHold(mine);
      if (mine.status === "needs_reapproval") return setPhase("reapprove");
      if (mine.status === "no_payment_needed") {
        await approve();
        return setPhase("done");
      }
      if (mine.pi_status === "requires_capture") { // already authorized earlier (e.g. page refresh)
        await approve(mine.amount_cents);
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

  // Approving with the held amount keeps an over-cap member's explicit consent (a bare approve would be refused).
  async function onAuthorized() {
    try {
      await approve(hold?.amount_cents, true);
      setPhase("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
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

  if (phase === "card" && sim) {
    return (
      <>
        <SimCardForm
          amountCents={hold?.amount_cents ?? 0}
          onAuthorize={async () => {
            await simAuthorize(groupId, planId, memberId, sim);
            await onAuthorized();
          }}
        />
        {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      </>
    );
  }

  if (phase === "card" && hold?.client_secret) {
    return (
      <Elements stripe={getStripe()} options={{ clientSecret: hold.client_secret, appearance: { theme: "stripe" } }}>
        <CardForm amountCents={hold.amount_cents ?? 0} onAuthorized={onAuthorized} />
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

function SimCardForm({ amountCents, onAuthorize }: { amountCents: number; onAuthorize: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await onAuthorize();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4">
      <p className="text-center text-sm text-amber-800">
        <span className="mr-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold">Simulated payment (test)</span>
        No card needed. Nothing is sent to Stripe.
      </p>
      <button onClick={submit} disabled={busy} className="w-full rounded-xl bg-emerald-600 p-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
        {busy ? "Placing hold…" : `Hold ${usd(amountCents)} (simulated)`}
      </button>
      {err && <p className="text-sm text-red-600 text-center">{err}</p>}
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
