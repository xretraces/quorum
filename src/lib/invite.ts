// Invite links. The QR code and Copy/Share always point at the LIVE site, never window.location.origin: a lobby
// shown from `npm run dev` (localhost / a LAN IP) or a protected Vercel preview would otherwise encode a URL
// the friend's phone can't open. Override with VITE_PUBLIC_URL (e.g. http://192.168.1.20:5173 to test locally).
export const PRODUCTION_URL = "https://quorum-eight-mu.vercel.app";

export const publicBaseUrl = () => (import.meta.env.VITE_PUBLIC_URL?.trim() || PRODUCTION_URL).replace(/\/+$/, "");

export const inviteUrl = (inviteCode: string) => `${publicBaseUrl()}/join/${encodeURIComponent(inviteCode)}`;

/** Copies text; falls back to execCommand where navigator.clipboard is missing (http LAN URL, some in-app browsers). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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

/** Groups in these states have picked their plan, so new people can only look, not join. */
export const isClosed = (g: { status: string; selected_plan_id: string | null }) =>
  !!g.selected_plan_id || !["planning", "voting"].includes(g.status);
