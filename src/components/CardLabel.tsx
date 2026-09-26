// The card behind a hold, e.g. [VISA] Visa •••• 4242. Drawn inline (no external brand assets).
import type { Card } from "../lib/booking";

const BRAND_NAME: Record<string, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", jcb: "JCB", unionpay: "UnionPay",
};
const brandName = (b: string) => BRAND_NAME[b] ?? b.charAt(0).toUpperCase() + b.slice(1);

export function VisaMark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-4 shrink-0 items-center rounded-[3px] border border-gray-200 bg-white px-1 text-[10px] font-black italic leading-none tracking-tight text-[#1A1F71]"
    >
      VISA
    </span>
  );
}

export function CardLabel({ card, className = "" }: { card: Card; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${className}`}>
      {card.brand === "visa" ? (
        <VisaMark />
      ) : (
        <span aria-hidden className="inline-flex h-4 items-center rounded-[3px] border border-gray-200 bg-white px-1 text-[9px] font-bold uppercase text-gray-700">
          {card.brand}
        </span>
      )}
      <span>
        {brandName(card.brand)} •••• {card.last4}
      </span>
    </span>
  );
}
