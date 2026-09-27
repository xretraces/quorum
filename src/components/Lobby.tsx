// Lobby: big QR code + Copy/Share for the invite link, members appearing live with a "ready" checkmark (never
// their answers), this member's "Fill out my answers" / "Edit my answers" button (the questionnaire has its own page,
// /g/:id/answers), and the creator's "Ask Grok" button. A member who hasn't answered yet sees their button first;
// the creator always keeps the QR code at the top.
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useT } from "../i18n/hooks";
import { avatarColor, initials } from "../lib/booking";
import { copyText, inviteUrl as inviteUrlFor } from "../lib/invite";
import type { Group, Member } from "../lib/supabase";
import { GrokAvatar } from "./Grok";

type Props = {
  group: Group;
  members: Member[];
  me: Member | undefined;
  busy: boolean;
  /** Just came back from saving answers: show a short confirmation. */
  saved: boolean;
  onAskGrok: () => void;
  onOpenAnswers: () => void;
};

export function Lobby({ group, members, me, busy, saved, onAskGrok, onOpenAnswers }: Props) {
  const t = useT();
  const [note, setNote] = useState<string | null>(null);
  const inviteUrl = inviteUrlFor(group.invite_code); // always the live site, even from localhost
  const ready = members.filter((m) => m.prefs_ready).length;
  const allReady = members.length > 0 && ready === members.length;
  const canForce = ready >= 2;
  const answerFirst = !!me && !me.is_organizer && !me.prefs_ready;

  const flash = (s: string) => {
    setNote(s);
    setTimeout(() => setNote(null), 2000);
  };
  async function copy() {
    flash((await copyText(inviteUrl)) ? t("lobby.copied") : t("lobby.copyFailed"));
  }
  async function share() {
    // Desktop browsers often have no navigator.share: fall back to copying the link.
    if (navigator.share) {
      try {
        await navigator.share({ title: t("lobby.shareTitle", { group: group.name }), text: t("lobby.shareText", { group: group.name }), url: inviteUrl });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy();
  }

  const myAnswers = me && (
    <section className="rounded-2xl bg-white p-4 shadow-md" data-testid="my-answers">
      {me.prefs_ready ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-gray-700">{t("lobby.answersIn")}</p>
          <button
            onClick={onOpenAnswers}
            className="min-h-11 shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            {t("lobby.editAnswers")}
          </button>
        </div>
      ) : (
        <>
          <h2 className="font-semibold text-gray-900">{t("lobby.yourTurn")}</h2>
          <p className="mt-1 text-sm text-gray-600">{t("lobby.fillPrompt")}</p>
          <button onClick={onOpenAnswers} className="mt-3 w-full rounded-xl bg-indigo-600 p-3 font-semibold text-white hover:bg-indigo-700">
            {t("lobby.fillAnswers")}
          </button>
        </>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      {saved && me?.prefs_ready && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{t("lobby.savedNote")}</p>
      )}
      {answerFirst && myAnswers}

      <section className="rounded-2xl bg-white p-4 text-center shadow-md">
        <p className="text-sm font-semibold text-gray-700">{t("lobby.scanToJoin")}</p>
        <p className="text-xs text-gray-500">{t("lobby.noApp")}</p>
        <div className="mx-auto mt-3 w-full max-w-[280px] rounded-2xl bg-white p-3 ring-1 ring-gray-200">
          <QRCodeSVG value={inviteUrl} size={512} marginSize={4} bgColor="#ffffff" fgColor="#000000" className="h-auto w-full" title={t("lobby.qrTitle", { group: group.name })} />
        </div>
        <p className="mt-2 break-all font-mono text-xs text-gray-500">{inviteUrl}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={copy} className="rounded-xl border border-gray-300 p-3 font-semibold text-gray-800 hover:bg-gray-50">
            {t("lobby.copyLink")}
          </button>
          <button onClick={share} className="rounded-xl bg-indigo-600 p-3 font-semibold text-white hover:bg-indigo-700">
            {t("common.share")}
          </button>
        </div>
        {note && <p role="status" className="mt-2 text-sm text-emerald-700">{note}</p>}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-md">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold text-gray-900">{t("lobby.whosIn", { count: members.length })}</h2>
          <span className="text-xs text-gray-500">{t("lobby.readyCount", { ready, total: members.length })}</span>
        </div>
        <ul className="divide-y divide-gray-100">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(m.display_name)}`}>
                {initials(m.display_name)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                <bdi>{m.display_name}</bdi>
                {m.is_organizer && <span className="ms-1 text-xs font-normal text-gray-500">{t("lobby.creatorTag")}</span>}
                {m.id === me?.id && <span className="ms-1 text-xs font-normal text-gray-500">{t("lobby.youTag")}</span>}
              </span>
              {m.prefs_ready ? (
                <span className="flex items-center gap-1 text-sm font-semibold text-emerald-600">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs text-white motion-safe:animate-pop">✓</span>
                  {t("lobby.ready")}
                </span>
              ) : (
                <span className="text-sm text-gray-400">{t("lobby.answering")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {!answerFirst && myAnswers}

      {me?.is_organizer ? (
        <section className="space-y-2 rounded-2xl bg-gray-900 p-4 text-white shadow-md">
          <div className="flex items-center gap-2">
            <GrokAvatar size={28} />
            <p className="text-sm">
              {allReady
                ? t("lobby.allReady")
                : canForce
                  ? t("lobby.canForce", { ready, total: members.length })
                  : t("lobby.needTwo")}
            </p>
          </div>
          <button
            disabled={busy || !(allReady || canForce)}
            onClick={onAskGrok}
            className="w-full rounded-xl bg-white p-3 font-semibold text-gray-900 disabled:opacity-40"
          >
            {allReady ? t("lobby.askGrok") : t("lobby.planAnyway")}
          </button>
        </section>
      ) : (
        me && (
          <p className="text-center text-sm text-gray-500">
            {t(allReady ? "lobby.waitingAllReady" : "lobby.waiting", { name: members.find((m) => m.is_organizer)?.display_name ?? t("common.theCreator") })}
          </p>
        )
      )}
    </div>
  );
}
