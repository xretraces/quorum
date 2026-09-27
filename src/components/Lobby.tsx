// Lobby: big QR code + Copy/Share for the invite link, members appearing live with a "ready" checkmark (never
// their answers), this phone's private questionnaire, and the creator's "Ask Grok" button.
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { avatarColor, initials } from "../lib/booking";
import { copyText, inviteUrl as inviteUrlFor } from "../lib/invite";
import type { Group, Member } from "../lib/supabase";
import { GrokAvatar } from "./Grok";
import { Questionnaire } from "./Questionnaire";

type Props = {
  group: Group;
  members: Member[];
  me: Member | undefined;
  busy: boolean;
  onAskGrok: () => void;
  onRefresh: () => void;
};

export function Lobby({ group, members, me, busy, onAskGrok, onRefresh }: Props) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inviteUrl = inviteUrlFor(group.invite_code); // always the live site, even from localhost
  const ready = members.filter((m) => m.prefs_ready).length;
  const allReady = members.length > 0 && ready === members.length;
  const canForce = ready >= 2;
  const showForm = !!me && (!me.prefs_ready || editing);

  const flash = (s: string) => {
    setNote(s);
    setTimeout(() => setNote(null), 2000);
  };
  async function copy() {
    flash((await copyText(inviteUrl)) ? "Copied!" : "Couldn't copy. Long-press the link instead.");
  }
  async function share() {
    // Desktop browsers often have no navigator.share: fall back to copying the link.
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${group.name} on Quorum`, text: `Join "${group.name}" on Quorum`, url: inviteUrl });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-4 text-center shadow-md">
        <p className="text-sm font-semibold text-gray-700">Scan to join</p>
        <p className="text-xs text-gray-500">No app needed. Just point your phone camera here.</p>
        <div className="mx-auto mt-3 w-full max-w-[280px] rounded-2xl bg-white p-3 ring-1 ring-gray-200">
          <QRCodeSVG value={inviteUrl} size={512} marginSize={4} bgColor="#ffffff" fgColor="#000000" className="h-auto w-full" title={`Invite link for ${group.name}`} />
        </div>
        <p className="mt-2 break-all font-mono text-xs text-gray-500">{inviteUrl}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={copy} className="rounded-xl border border-gray-300 p-3 font-semibold text-gray-800 hover:bg-gray-50">
            Copy link
          </button>
          <button onClick={share} className="rounded-xl bg-indigo-600 p-3 font-semibold text-white hover:bg-indigo-700">
            Share
          </button>
        </div>
        {note && <p role="status" className="mt-2 text-sm text-emerald-700">{note}</p>}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-md">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold text-gray-900">Who's in ({members.length})</h2>
          <span className="text-xs text-gray-500">{ready} of {members.length} ready</span>
        </div>
        <ul className="divide-y divide-gray-100">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(m.display_name)}`}>
                {initials(m.display_name)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                {m.display_name}
                {m.is_organizer && <span className="ml-1 text-xs font-normal text-gray-500">· creator</span>}
                {m.id === me?.id && <span className="ml-1 text-xs font-normal text-gray-500">· you</span>}
              </span>
              {m.prefs_ready ? (
                <span className="flex items-center gap-1 text-sm font-semibold text-emerald-600">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs text-white motion-safe:animate-pop">✓</span>
                  Ready
                </span>
              ) : (
                <span className="text-sm text-gray-400">Answering…</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {me && (
        <section className="rounded-2xl bg-white p-4 shadow-md">
          {showForm ? (
            <>
              <h2 className="mb-3 font-semibold text-gray-900">Your answers</h2>
              <Questionnaire
                memberId={me.id}
                onSaved={() => {
                  setEditing(false);
                  onRefresh();
                }}
              />
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-700">✓ Your answers are in. Only Grok sees them.</p>
              <button onClick={() => setEditing(true)} className="shrink-0 text-sm font-semibold text-indigo-600">Edit</button>
            </div>
          )}
        </section>
      )}

      {me?.is_organizer ? (
        <section className="space-y-2 rounded-2xl bg-gray-900 p-4 text-white shadow-md">
          <div className="flex items-center gap-2">
            <GrokAvatar size={28} />
            <p className="text-sm">
              {allReady
                ? "Everyone's ready. Grok can plan now."
                : canForce
                  ? `${ready} of ${members.length} are ready. You can wait, or plan it anyway.`
                  : "Grok needs at least 2 people's answers."}
            </p>
          </div>
          <button
            disabled={busy || !(allReady || canForce)}
            onClick={onAskGrok}
            className="w-full rounded-xl bg-white p-3 font-semibold text-gray-900 disabled:opacity-40"
          >
            {allReady ? "✨ Ask Grok" : "✨ Plan it anyway"}
          </button>
        </section>
      ) : (
        me && (
          <p className="text-center text-sm text-gray-500">
            {allReady ? "Everyone's ready. " : ""}Waiting for {members.find((m) => m.is_organizer)?.display_name ?? "the creator"} to ask Grok.
          </p>
        )
      )}
    </div>
  );
}
