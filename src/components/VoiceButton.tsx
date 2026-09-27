// Push-to-talk: tap to record, tap again to stop. Audio goes to Grok Voice Transcribe
// (supabase/functions/transcribe). Falls back to the browser Web Speech API if needed.
import { useEffect, useRef, useState } from "react";
import {
  browserDictate,
  canRecordAudio,
  grokVoiceUnavailable,
  MAX_RECORD_MS,
  recordAudio,
  transcribeWithGrok,
  type VoiceSource,
} from "../lib/voice";

type Props = {
  onTranscript: (text: string, source: VoiceSource) => void | Promise<void>;
  extraKeyterms?: string[];
  disabled?: boolean;
  className?: string;
  idleLabel?: string;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
};

export function VoiceButton({
  onTranscript,
  extraKeyterms = [],
  disabled,
  className,
  idleLabel = "🎙 Voice",
  onError,
  onInfo,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "recording" | "listening" | "transcribing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const preferBrowser = useRef(false);

  useEffect(() => {
    if (phase !== "recording") return;
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function finishGrok(signal: AbortSignal) {
    const { blob, mime } = await recordAudio(signal);
    if (blob.size < 800) throw new Error("I didn't catch that. Tap Voice and speak a bit longer.");
    setPhase("transcribing");
    const result = await transcribeWithGrok(blob, mime, extraKeyterms);
    if (!result.text.trim()) throw new Error("Grok Voice heard silence. Try again.");
    await onTranscript(result.text.trim(), "grok");
  }

  async function finishBrowser() {
    setPhase("listening");
    onInfo?.("Listening with the browser… speak now.");
    const text = (await browserDictate()).trim();
    if (!text) throw new Error("I didn't catch that. Try again or type it.");
    await onTranscript(text, "browser");
  }

  async function toggle() {
    if (disabled || phase === "transcribing" || phase === "listening") return;
    if (phase === "recording") {
      abortRef.current?.abort();
      return;
    }

    const useBrowser = preferBrowser.current || !canRecordAudio();
    setPhase(useBrowser ? "listening" : "recording");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      if (useBrowser) await finishBrowser();
      else await finishGrok(ac.signal);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") {
        onError?.("Microphone permission denied. Allow the mic in the browser, or type it.");
      } else if (name === "NotFoundError") {
        onError?.("No microphone found. Plug one in, or type it.");
      } else if (!useBrowser && grokVoiceUnavailable(e)) {
        preferBrowser.current = true;
        onInfo?.(`Grok Voice is unavailable (${e instanceof Error ? e.message : String(e)}). Tap Voice again to use the browser, or type it.`);
      } else {
        onError?.(e instanceof Error ? e.message : String(e));
      }
    } finally {
      abortRef.current = null;
      setPhase("idle");
      setElapsed(0);
    }
  }

  const label =
    phase === "recording"
      ? `● Stop${elapsed > 0 ? ` ${elapsed}s` : ""}`
      : phase === "transcribing"
        ? "Grok is listening…"
        : phase === "listening"
          ? "Listening…"
          : idleLabel;
  const recording = phase === "recording";
  const busy = phase === "transcribing" || phase === "listening";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || busy}
      title={recording ? `Recording — tap to stop (max ${MAX_RECORD_MS / 1000}s)` : "Speak your budget and preferences. Grok Voice transcribes it."}
      className={`${className ?? "rounded-xl border border-gray-300 px-4 py-3 text-gray-700 transition-colors hover:bg-gray-50"} disabled:opacity-50 ${
        recording ? "border-red-300 bg-red-50 font-semibold text-red-700 hover:bg-red-50" : ""
      }`}
    >
      {label}
    </button>
  );
}
