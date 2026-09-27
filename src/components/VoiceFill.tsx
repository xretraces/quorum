// "Tell Grok about yourself": speak (Grok Voice, via Thang's VoiceButton) or type one sentence, and Grok
// (parse-prefs) fills the questionnaire. The person reviews and edits, then saves as usual.
// Merge rule: a field Grok heard fills or replaces that field; `other` is appended, never replaced.
// Kept out of Questionnaire.tsx on purpose (that file is Kus's and is being translated), so it needs only
// the current answers and the form's own applyPreferences.
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/hooks";
import type { Preferences } from "../lib/prefs";
import { parsePrefs } from "../lib/parsePrefs";
import { voiceFillPatch } from "../lib/voiceFill";
import { VoiceButton } from "./VoiceButton";

type Props = {
  current: Preferences;
  apply: (partial: Partial<Preferences>) => void;
};

const FIELDS = ["budget", "dietary", "availability", "other"] as const;
type Field = (typeof FIELDS)[number];

export function VoiceFill({ current, apply }: Props) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "info" | "err"; text: string } | null>(null);
  const [changed, setChanged] = useState<Field[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const currentRef = useRef(current);
  currentRef.current = current;

  // Briefly ring the fields Grok changed. The inputs live in Questionnaire, in the same <form> after this block.
  useEffect(() => {
    if (!changed.length) return;
    const form = box.current?.closest("form");
    const fields = form ? Array.from(form.querySelectorAll<HTMLElement>("input, textarea")).filter((el) => !box.current?.contains(el)) : [];
    const els = changed.map((f) => fields[FIELDS.indexOf(f)]).filter(Boolean);
    for (const el of els) {
      el.style.transition = "box-shadow 0.3s, background-color 0.3s";
      el.style.boxShadow = "0 0 0 4px rgb(154 214 244 / 0.7)";
      el.style.backgroundColor = "rgb(154 214 244 / 0.15)";
    }
    const id = window.setTimeout(() => {
      for (const el of els) {
        el.style.boxShadow = "";
        el.style.backgroundColor = "";
      }
    }, 2500);
    return () => window.clearTimeout(id);
  }, [changed]);

  async function fill(input: string) {
    const said = input.trim();
    if (!said || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const patch = voiceFillPatch(currentRef.current, await parsePrefs(said));
      const keys = FIELDS.filter((k) => patch[k] !== undefined);
      if (!keys.length) {
        setMsg({ kind: "info", text: t("voice.nothingHeard") });
        return;
      }
      apply(patch);
      setChanged(keys);
      setMsg({ kind: "ok", text: t("voice.filled") });
    } catch (e) {
      setMsg({ kind: "err", text: t("voice.readFailed", { error: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={box} className="space-y-3" data-voice-fill>
      <label className="block text-base font-semibold text-navy" htmlFor="voice-fill-text">
        {t("voice.title")}
      </label>
      <textarea
        id="voice-fill-text"
        className="q-form-input h-20 resize-none"
        placeholder={t("voice.placeholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void fill(text);
          }
        }}
      />
      <div className="flex gap-2">
        <VoiceButton
          idleLabel={t("voice.speak")}
          disabled={busy}
          className="q-btn q-btn-secondary min-h-11 px-4 text-sm"
          onTranscript={async (heard) => {
            setText(heard);
            await fill(heard);
          }}
          onError={(m) => setMsg({ kind: "err", text: m })}
          onInfo={(m) => setMsg({ kind: "info", text: m })}
        />
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void fill(text)}
          className="q-btn q-btn-dark min-h-11 flex-1 px-4 text-sm"
        >
          {busy ? t("voice.reading") : t("voice.fill")}
        </button>
      </div>
      {msg && (
        <p role="status" className={`text-sm ${msg.kind === "err" ? "text-red-700" : msg.kind === "ok" ? "font-medium text-navy" : "text-navy/65"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
