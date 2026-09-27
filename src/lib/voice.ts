// Browser mic → Grok Voice Transcribe (via the `transcribe` Edge Function).
// The xAI key stays on the server. If MediaRecorder or the function is unavailable,
// we fall back to the browser Web Speech API so the demo still works.
//
// A take ends by: tap Stop (always), ~2.5s of silence after they have started talking, or 45s.

import { invoke, InvokeError } from "./supabase";
import {
  isInfraTranscribeFailure,
  isPhone,
  createLevelTracker,
  joinTranscriptParts,
  MAX_RECORD_MS,
  mimeToFilename,
  pickRecorderMime,
  RECORDER_MIME_CANDIDATES,
  rmsFromTimeDomain,
  shouldAutoStop,
  shouldRestartRecognition,
  shouldRunParallelStt,
  SILENCE_MS,
  trackLevel,
} from "./voice-logic";

export type VoiceSource = "grok" | "browser";
export type TranscribeResponse = { text: string; language?: string; duration?: number | null; model?: string };
export type VoiceCaptureOpts = {
  signal: AbortSignal;
  maxMs?: number;
  silenceMs?: number;
  /** Fires after the mic is actually live — not while the permission prompt is up. */
  onStarted?: () => void;
};

export { MAX_RECORD_MS, mimeToFilename, RECORDER_MIME_CANDIDATES, SILENCE_MS };

export function pickSupportedRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
}

export function canRecordAudio(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export function parallelSttEnabled(): boolean {
  if (!getSpeechRecognitionCtor()) return false;
  return shouldRunParallelStt(import.meta.env.VITE_VOICE_PARALLEL, isPhone(navigator.userAgent, navigator.maxTouchPoints));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(new Error("Could not read the recording."));
    reader.readAsDataURL(blob);
  });
}

async function closeAudioContext(ctx: AudioContext | null): Promise<void> {
  if (!ctx || ctx.state === "closed") return;
  try {
    await ctx.close();
  } catch {
    /* already closed */
  }
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

/** Room noise floor from the previous take: seeds the next take until its own calibration is done. */
let lastTakeFloor: number | null = null;

/** Record until Stop, ~2.5s of post-speech silence, or MAX_RECORD_MS. Always releases the mic + AudioContext. */
export async function recordAudio(opts: VoiceCaptureOpts): Promise<{ blob: Blob; mime: string }> {
  const maxMs = opts.maxMs ?? MAX_RECORD_MS;
  const silenceMs = opts.silenceMs ?? SILENCE_MS;
  // Create/resume the AudioContext synchronously inside the tap, before the permission prompt. Created after
  // `await getUserMedia` it has lost the user gesture, so iOS Safari leaves it suspended (all-silent analyser)
  // on the first take. Part of the cold-start fix; see createLevelTracker.
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext | null = null;
  try {
    ctx = AudioCtx ? new AudioCtx() : null;
    void ctx?.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
  let stream: MediaStream;
  let rec: MediaRecorder;
  const mime = pickSupportedRecorderMime();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    await closeAudioContext(ctx);
    throw e;
  }
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch {
    // Some Safari builds reject an explicit mimeType they claim to support; let the browser pick.
    try {
      rec = new MediaRecorder(stream);
    } catch (e) {
      stopStream(stream);
      await closeAudioContext(ctx);
      throw e;
    }
  }
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  let poll = 0;
  let heardSpeech = false;
  let lastSpeechAt: number | null = null;
  const levels = createLevelTracker(lastTakeFloor);

  const stopped = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || mime || RECORDER_MIME_CANDIDATES[0] }));
    rec.onerror = () => reject(new Error("Recording failed. Check the microphone and try again."));
  });

  const stopRec = () => {
    if (rec.state === "recording") rec.stop();
  };

  try {
    if (ctx) {
      await ctx.resume().catch(() => undefined);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(analyser);
      analyser.connect(mute);
      mute.connect(ctx.destination);
      const buf = new Uint8Array(analyser.fftSize);
      poll = window.setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        const now = Date.now();
        const rms = rmsFromTimeDomain(buf);
        const speaking = trackLevel(levels, rms, now);
        if (levels.calibrated) lastTakeFloor = levels.floor;
        if (speaking) {
          heardSpeech = true;
          lastSpeechAt = now;
        } else if (shouldAutoStop({ heardSpeech, lastSpeechAt, now, silenceMs })) {
          stopRec();
        }
      }, 100);
    }

    rec.start(250);
    opts.onStarted?.();

    const timer = window.setTimeout(stopRec, maxMs);
    const onAbort = () => stopRec();
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });

    try {
      const blob = await stopped;
      return { blob, mime: blob.type || mime || RECORDER_MIME_CANDIDATES[0] };
    } finally {
      window.clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
    }
  } finally {
    if (poll) window.clearInterval(poll);
    stopStream(stream);
    await closeAudioContext(ctx);
  }
}

// `invoke`'s name union lives in supabase.ts, which other open branches also extend; widen it here instead
// so this branch doesn't touch that line.
const invokeFn = invoke as unknown as <T>(fn: "transcribe", body: unknown) => Promise<T>;

export async function transcribeWithGrok(blob: Blob, mime: string, extraKeyterms: string[] = []): Promise<TranscribeResponse> {
  const audio_base64 = await blobToBase64(blob);
  const mimeType = mime.split(";")[0] || RECORDER_MIME_CANDIDATES[0];
  return invokeFn<TranscribeResponse>("transcribe", {
    audio_base64,
    mime_type: mimeType,
    keyterms: extraKeyterms.filter(Boolean).slice(0, 20),
  });
}

type SpeechResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onaudiostart: (() => void) | null;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export function getSpeechRecognitionCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Live browser STT. Always settles (onend), even if the user was silent.
 * Tap-Stop / abort, 2.5s after the last result (once they have spoken), or 45s.
 * Restarts if the browser ends the session early (common on iPhone).
 */
export function browserDictate(opts: VoiceCaptureOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      reject(new Error("Grok Voice isn't available, and this browser has no speech recognition (try Chrome)."));
      return;
    }
    const maxMs = opts.maxMs ?? MAX_RECORD_MS;
    const silenceMs = opts.silenceMs ?? SILENCE_MS;
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    const finals: string[] = [];
    let interim = "";
    let lastResultAt: number | null = null;
    let settled = false;
    let aborted = false;
    let reachedMax = false;
    let silenced = false;
    let poll = 0;
    let maxTimer = 0;
    let started = false;

    const textNow = () => joinTranscriptParts([...finals, interim]);
    // Only once audio is really flowing; `onstart` can fire while the permission prompt is still up.
    const markStarted = () => {
      if (started || settled) return;
      started = true;
      opts.onStarted?.();
    };

    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(maxTimer);
      opts.signal.removeEventListener("abort", onAbort);
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      resolve(text);
    };

    const onAbort = () => {
      aborted = true;
      finish(textNow());
    };

    rec.onresult = (e) => {
      markStarted();
      lastResultAt = Date.now();
      let nextInterim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0]?.transcript ?? "";
        if (e.results[i].isFinal) finals.push(piece);
        else nextInterim += piece;
      }
      interim = nextInterim;
    };

    const fail = (err: DOMException) => {
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(maxTimer);
      opts.signal.removeEventListener("abort", onAbort);
      reject(err);
    };

    rec.onerror = (e) => {
      const err = e.error ?? "";
      if (err === "not-allowed" || err === "service-not-allowed") {
        fail(new DOMException("Microphone permission denied.", "NotAllowedError"));
        return;
      }
      if (err === "audio-capture") {
        fail(new DOMException("No microphone found.", "NotFoundError"));
        return;
      }
      // no-speech / aborted / network: wait for onend so we never hang on "Listening…"
    };

    rec.onend = () => {
      if (settled) return;
      if (shouldRestartRecognition({ settled, aborted, reachedMax, silenced })) {
        try {
          rec.start();
          return;
        } catch {
          finish(textNow());
          return;
        }
      }
      finish(textNow());
    };

    rec.onaudiostart = markStarted;

    poll = window.setInterval(() => {
      if (lastResultAt !== null && shouldAutoStop({ heardSpeech: true, lastSpeechAt: lastResultAt, now: Date.now(), silenceMs })) {
        silenced = true;
        finish(textNow());
      }
    }, 200);
    maxTimer = window.setTimeout(() => {
      reachedMax = true;
      finish(textNow());
    }, maxMs);

    if (opts.signal.aborted) {
      onAbort();
      return;
    }
    opts.signal.addEventListener("abort", onAbort, { once: true });
    try {
      rec.start();
    } catch (e) {
      opts.signal.removeEventListener("abort", onAbort);
      reject(e instanceof Error ? e : new Error("Voice recognition failed. Try again or type it."));
    }
  });
}

export function grokVoiceUnavailable(e: unknown): boolean {
  if (!(e instanceof InvokeError)) return false;
  return isInfraTranscribeFailure(e.fromFunction, e.status);
}
