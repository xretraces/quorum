// Waiting screen, shown once this member's answers are in and others are still answering: "2 of 3 ready" with the
// names of who's ready and who's still answering (never their answers). No QR code: the lobby's invite only opens
// again from the small "Invite more" link. Plans start on their own when the last person answers; the creator
// can also start them early ("Make plans now") once at least 2 people are ready.
import { iso, isoList } from "../i18n/bidi";
import { useT, useTNodes } from "../i18n/hooks";
import type { Member } from "../lib/supabase";

type Props = {
  members: Member[];
  me: Member;
  busy: boolean;
  /** Just came back from saving answers: show a short confirmation. */
  saved: boolean;
  onMakePlans: () => void;
  onOpenAnswers: () => void;
  onInvite: () => void;
};

const link = "inline-flex min-h-10 items-center text-sm font-semibold text-navy underline underline-offset-4 disabled:opacity-50";

export function Waiting({ members, me, busy, saved, onMakePlans, onOpenAnswers, onInvite }: Props) {
  const t = useT();
  const tNodes = useTNodes();
  const sep = t("common.listSep");
  const readyNames = members.filter((m) => m.prefs_ready).map((m) => m.display_name);
  const answeringNames = members.filter((m) => !m.prefs_ready).map((m) => m.display_name);
  const ready = readyNames.length;
  const allReady = members.length > 0 && answeringNames.length === 0;

  return (
    <section data-testid="waiting" className="mx-auto w-full max-w-xl space-y-6 text-center">
      {saved && <p role="status" className="text-sm font-semibold text-emerald-700">{t("lobby.savedNote")}</p>}

      <div>
        <h2 className="q-h2 text-3xl sm:text-4xl">{t(allReady ? "waiting.allReadyTitle" : "waiting.title")}</h2>
        <p className="mt-2 text-base font-bold tabular-nums text-navy/80">{t("lobby.readyCount", { ready, total: members.length })}</p>
        <div className="mx-auto mt-3 flex max-w-xs gap-1" aria-hidden>
          {members.map((m, i) => (
            <span key={m.id} className={`h-2.5 flex-1 rounded-[3px] transition-colors ${i < ready ? "bg-sun ring-1 ring-navy/30" : "bg-navy/10"}`} />
          ))}
        </div>
      </div>

      <div className="space-y-2 text-sm text-navy">
        {ready > 0 && <p><span className="font-semibold text-emerald-700">✓</span> {tNodes("waiting.readyList", { names: isoList(readyNames, sep) })}</p>}
        {answeringNames.length > 0 && <p className="text-navy/70">{tNodes("waiting.answeringList", { names: isoList(answeringNames, sep) })}</p>}
      </div>

      {allReady ? (
        me.is_organizer ? (
          <button disabled={busy} onClick={onMakePlans} className="q-btn q-btn-primary">{t("lobby.askGrok")}</button>
        ) : (
          <p className="text-sm font-medium text-navy/65">
            {tNodes("lobby.waitingAllReady", { name: iso(members.find((m) => m.is_organizer)?.display_name ?? t("common.theCreator")) })}
          </p>
        )
      ) : (
        <p className="text-sm font-medium text-navy/65">{t("waiting.autoNote")}</p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
        <button onClick={onOpenAnswers} className={link}>{t("lobby.editAnswers")}</button>
        {me.is_organizer && !allReady && ready >= 2 && (
          <button disabled={busy} onClick={onMakePlans} className={link}>{t("waiting.makeNow")}</button>
        )}
        <button onClick={onInvite} className={link}>{t("waiting.inviteMore")}</button>
      </div>
    </section>
  );
}
