// "Tell Grok about yourself": speak (Grok Voice, via Thang's VoiceButton) or type one sentence, and Grok
// (parse-prefs) fills the questionnaire. The person reviews and edits, then saves as usual.
// Merge rule: a field Grok heard fills or replaces that field; `other` is appended, never replaced.
// Kept out of Questionnaire.tsx on purpose (that file is Kus's and is being translated), so it needs only
// the current answers and the form's own applyPreferences.
import { useEffect, useRef, useState } from "react";
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
      el.style.boxShadow = "0 0 0 3px rgb(129 140 248)";
      el.style.backgroundColor = "rgb(238 242 255)";
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
        setMsg({ kind: "info", text: "Grok didn't hear a budget, diet, or time in that. Try again or type in the fields." });
        return;
      }
      apply(patch);
      setChanged(keys);
      setMsg({ kind: "ok", text: "Filled by Grok — check and edit" });
    } catch (e) {
      setMsg({ kind: "err", text: `Grok couldn't read that (${e instanceof Error ? e.message : String(e)}). Type your answers below.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={box} className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3" data-voice-fill>
      <label className="block text-sm font-medium text-gray-800" htmlFor="voice-fill-text">
        Tell Grok about yourself
      </label>
      <textarea
        id="voice-fill-text"
        className="h-16 w-full resize-none rounded-lg border border-gray-300 bg-white p-2 text-base"
        placeholder="e.g. I'm vegetarian, about $40, free after 6, no bars"
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
          idleLabel="🎙 Speak"
          disabled={busy}
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-gray-700"
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
          className="flex-1 rounded-xl bg-gray-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Grok is reading…" : "Fill with Grok"}
        </button>
      </div>
      {msg && (
        <p role="status" className={`text-sm ${msg.kind === "err" ? "text-red-600" : msg.kind === "ok" ? "text-indigo-700" : "text-gray-600"}`}>
          {msg.kind === "ok" ? "✨ " : ""}
          {msg.text}
        </p>
      )}
    </div>
  );
}
