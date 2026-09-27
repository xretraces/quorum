// Tap to start, tap Stop to end (main path). Also auto-stops after ~2.5s of silence
// once they have started talking, or at 45s. Audio goes to Grok Voice Transcribe.
// If that fails, we use the browser transcript from the same take when we have one (laptops),
// otherwise an infra failure starts browser STT automatically (no extra tap).
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/hooks";
import {
  browserDictate,
  canRecordAudio,
  grokVoiceUnavailable,
  MAX_RECORD_MS,
  parallelSttEnabled,
  recordAudio,
  transcribeWithGrok,
  type VoiceSource,
} from "../lib/voice";
import { chooseTakeOutcome } from "../lib/voice-logic";

// Errors thrown with fixed English text by lib/voice.ts, shown translated.
const LIB_ERRORS: Record<string, string> = {
  "Could not read the recording.": "voice.readRecordingFailed",
  "Recording failed. Check the microphone and try again.": "voice.recordingFailed",
  "Grok Voice isn't available, and this browser has no speech recognition (try Chrome).": "voice.noSpeechApi",
  "Voice recognition failed. Try again or type it.": "voice.recognitionFailed",
};

type Phase = "idle" | "starting" | "recording" | "listening" | "transcribing";

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
  idleLabel,
  onError,
  onInfo,
}: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const preferBrowser = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording" && phase !== "listening") return;
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  async function deliver(text: string, source: VoiceSource) {
    if (!mountedRef.current) return;
    const trimmed = text.trim();
    if (!trimmed) throw new Error(t("voice.didntCatch"));
    await onTranscript(trimmed, source);
  }

  async function finishBrowser(signal: AbortSignal) {
    const text = await browserDictate({
      signal,
      onStarted: () => {
        if (mountedRef.current) setPhase("listening");
      },
    });
    if (!mountedRef.current) return;
    await deliver(text, "browser");
  }

  async function finishGrok(signal: AbortSignal) {
    // Laptops: collect a browser transcript during the same take, so a failed transcribe
    // call can still post what they said. Off on phones (see shouldRunParallelStt).
    const browserP = parallelSttEnabled() ? browserDictate({ signal }).catch(() => "") : Promise.resolve("");
    let blob: Blob;
    let mime: string;
    try {
      ({ blob, mime } = await recordAudio({
        signal,
        onStarted: () => {
          if (mountedRef.current) setPhase("recording");
        },
      }));
    } catch (e) {
      if (!signal.aborted) abortRef.current?.abort();
      await browserP;
      throw e;
    }
    if (!signal.aborted) abortRef.current?.abort();
    const browserText = (await browserP).trim();
    if (!mountedRef.current) return;
    if (blob.size < 800 && !browserText) throw new Error(t("voice.tooShort"));
    if (blob.size < 800 && browserText) {
      await deliver(browserText, "browser");
      return;
    }
    setPhase("transcribing");
    let grokText = "";
    let grokErr: unknown = null;
    try {
      grokText = (await transcribeWithGrok(blob, mime, extraKeyterms)).text ?? "";
    } catch (e) {
      grokErr = e;
    }
    if (!mountedRef.current) return;

    const infra = grokErr !== null && grokVoiceUnavailable(grokErr);
    if (infra) preferBrowser.current = true;
    const why = grokErr ? (grokErr instanceof Error ? grokErr.message : String(grokErr)) : t("voice.heardSilence");
    const outcome = chooseTakeOutcome({ grokText, grokFailed: grokErr !== null, infra, browserText });
    switch (outcome.kind) {
      case "grok":
        await deliver(outcome.text, "grok");
        return;
      case "browser":
        onInfo?.(t("voice.usingBrowser", { why }));
        await deliver(outcome.text, "browser");
        return;
      case "relisten": {
        onInfo?.(t("voice.relisten", { why }));
        const ac = new AbortController();
        abortRef.current = ac;
        setPhase("starting");
        await finishBrowser(ac.signal);
        return;
      }
      case "error":
        throw grokErr ?? new Error(t("voice.silence"));
    }
  }

  async function toggle() {
    if (disabled || phase === "transcribing" || phase === "starting") return;
    if (phase === "recording" || phase === "listening") {
      abortRef.current?.abort();
      return;
    }

    const useBrowser = preferBrowser.current || !canRecordAudio();
    setPhase("starting");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      if (useBrowser) await finishBrowser(ac.signal);
      else await finishGrok(ac.signal);
    } catch (e) {
      if (!mountedRef.current) return;
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") {
        onError?.(t("voice.micDenied"));
      } else if (name === "NotFoundError") {
        onError?.(t("voice.noMic"));
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        onError?.(LIB_ERRORS[msg] ? t(LIB_ERRORS[msg]) : msg);
      }
    } finally {
      abortRef.current = null;
      if (mountedRef.current) {
        setPhase("idle");
        setElapsed(0);
      }
    }
  }

  const live = phase === "recording" || phase === "listening";
  const label =
    phase === "starting"
      ? t("voice.starting")
      : live
        ? elapsed > 0 ? t("voice.stopSeconds", { seconds: elapsed }) : t("voice.stop")
        : phase === "transcribing"
          ? t("voice.listening")
          : idleLabel ?? t("voice.voice");
  const locked = phase === "transcribing" || phase === "starting";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || locked}
      title={
        live
          ? t("voice.hintLive", { seconds: MAX_RECORD_MS / 1000 })
          : phase === "starting"
            ? t("voice.hintStarting")
            : t("voice.hintIdle")
      }
      className={`${className ?? "rounded-xl border border-gray-300 px-4 py-3 text-gray-700 transition-colors hover:bg-gray-50"} disabled:opacity-50 ${
        live ? "border-red-300 bg-red-50 font-semibold text-red-700 hover:bg-red-50" : ""
      }`}
    >
      {label}
    </button>
  );
}
