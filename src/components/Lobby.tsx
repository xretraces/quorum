// Lobby: big QR code + Copy/Share for the invite link, members appearing live with a "ready" checkmark (never
// their answers), this member's "Fill out my answers" / "Edit my answers" button (the questionnaire has its own page,
// /g/:id/answers), and the creator's "Ask Grok" button. A member who hasn't answered yet sees their button first;
// the creator always keeps the QR code at the top.
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { iso } from "../i18n/bidi";
import { useT, useTNodes } from "../i18n/hooks";
import { avatarColor, initials } from "../lib/booking";
import { copyText, inviteUrl as inviteUrlFor } from "../lib/invite";
import type { Group, Member } from "../lib/supabase";

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
  const tNodes = useTNodes();
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

  const canPlan = allReady || canForce;

  const myAnswers = me && (
    <div data-testid="my-answers">
      {me.prefs_ready ? (
        <div className="flex flex-col items-end gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-navy">
            <CheckTile />
            {t("lobby.answersIn")}
          </p>
          <button onClick={onOpenAnswers} className="q-btn q-btn-secondary min-h-10 px-4 text-sm">
            {t("lobby.editAnswers")}
          </button>
        </div>
      ) : (
        <button onClick={onOpenAnswers} className="q-btn q-btn-primary">
          {t("lobby.fillAnswers")}
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-12">
      {saved && me?.prefs_ready && (
        <p role="status" className="mx-auto max-w-3xl text-center text-sm font-semibold text-emerald-700">{t("lobby.savedNote")}</p>
      )}

      {answerFirst && (
        <div className="mx-auto w-full max-w-3xl text-center">
          {myAnswers}
        </div>
      )}

      <section className="mx-auto w-full max-w-3xl text-center">
        <h2 className="q-h2 text-3xl sm:text-4xl">{t("lobby.scanToJoin")}</h2>
        <p className="q-muted mx-auto mt-2 max-w-lg text-base">{t("lobby.noApp")}</p>
        <div className="mx-auto mt-6 w-56 bg-white p-3 sm:w-64">
          <QRCodeSVG value={inviteUrl} size={512} marginSize={1} bgColor="#ffffff" fgColor="#164e72" className="block h-auto w-full" title={t("lobby.qrTitle", { group: group.name })} />
        </div>
        <p className="mx-auto mt-4 max-w-xl break-all font-mono text-sm text-navy/50" title={inviteUrl}>{inviteUrl}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button onClick={copy} className="q-btn q-btn-secondary min-h-11 px-5 text-sm">
            {t("lobby.copyLink")}
          </button>
          <button onClick={share} className="q-btn q-btn-dark min-h-11 px-5 text-sm">
            {t("common.share")}
          </button>
        </div>
        {note && <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{note}</p>}
      </section>

      <div className="mx-auto flex w-full max-w-3xl items-start gap-8 max-sm:flex-col">
        <section className="w-full min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="q-h2 text-xl">{t("lobby.whosIn", { count: members.length })}</h2>
            <span className="text-xs font-bold tabular-nums text-navy/55">{t("lobby.readyCount", { ready, total: members.length })}</span>
          </div>
          <ReadyMeter ready={ready} total={members.length} />
          <ul className="mt-2 divide-y divide-navy/10">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 py-2">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white ${avatarColor(m.display_name)}`}>
                  {initials(m.display_name)}
                </span>
                {/* The name truncates inside its own <bdi>, so a long Latin name in Arabic keeps its start and ends in "…"
                    (truncating the whole RTL row cut the name's first letters), and the creator / you tags stay visible. */}
                <span className="flex min-w-0 flex-1 items-baseline text-sm font-semibold text-navy">
                  <bdi className="min-w-0 truncate">{m.display_name}</bdi>
                  {m.is_organizer && <span className="ms-1.5 shrink-0 text-xs font-medium text-navy/50">{t("lobby.creatorTag")}</span>}
                  {m.id === me?.id && <span className="ms-1.5 shrink-0 text-xs font-medium text-navy/50">{t("lobby.youTag")}</span>}
                </span>
                {m.prefs_ready ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-700">
                    <CheckTile pop />
                    {t("lobby.ready")}
                  </span>
                ) : (
                  <span className="text-xs text-navy/45">{t("lobby.answering")}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {!answerFirst && me && (
          <div className="shrink-0 pt-1 sm:pt-7">
            {myAnswers}
          </div>
        )}
      </div>

      {me?.is_organizer ? (
        <section className="mx-auto w-full max-w-3xl text-center">
          <p className={`mx-auto max-w-lg text-sm font-semibold ${canPlan ? "text-navy" : "text-navy/55"}`}>
            {allReady
              ? t("lobby.allReady")
              : canForce
                ? t("lobby.canForce", { ready, total: members.length })
                : t("lobby.needTwo")}
          </p>
          <button disabled={busy || !canPlan} onClick={onAskGrok} className="q-btn q-btn-primary mt-4">
            {allReady ? t("lobby.askGrok") : t("lobby.planAnyway")}
          </button>
        </section>
      ) : (
        me && (
          <p className="mx-auto max-w-3xl text-center text-sm font-medium text-navy/65">
            {tNodes(allReady ? "lobby.waitingAllReady" : "lobby.waiting", { name: iso(members.find((m) => m.is_organizer)?.display_name ?? t("common.theCreator")) })}
          </p>
        )
      )}
    </div>
  );
}

function CheckTile({ pop = false }: { pop?: boolean }) {
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500 text-xs font-bold text-white ${pop ? "motion-safe:animate-pop" : ""}`}>
      ✓
    </span>
  );
}

/** One block per member, filled as they finish, so progress reads at a glance. */
function ReadyMeter({ ready, total }: { ready: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="mt-2.5 flex gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-2.5 flex-1 rounded-[3px] transition-colors ${i < ready ? "bg-sun ring-1 ring-navy/30" : "bg-navy/10"}`} />
      ))}
    </div>
  );
}
