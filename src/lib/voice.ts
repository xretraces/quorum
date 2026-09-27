// Browser mic → Grok Voice Transcribe (via the `transcribe` Edge Function).
// The xAI key stays on the server. If MediaRecorder or the function is unavailable,
// we fall back to the browser Web Speech API so the demo still works.

import { invoke, InvokeError } from "./supabase";

export type VoiceSource = "grok" | "browser";
export type TranscribeResponse = { text: string; language?: string; duration?: number | null; model?: string };

const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
export const MAX_RECORD_MS = 45_000;

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export function canRecordAudio(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
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

/** Record until `signal` aborts or MAX_RECORD_MS. Caller must stop tracks; we stop them here too. */
export async function recordAudio(signal: AbortSignal, maxMs = MAX_RECORD_MS): Promise<{ blob: Blob; mime: string }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const mime = pickRecorderMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }));
    rec.onerror = () => reject(new Error("Recording failed. Check the microphone and try again."));
  });

  rec.start(250);
  const timer = window.setTimeout(() => {
    if (rec.state === "recording") rec.stop();
  }, maxMs);
  const onAbort = () => {
    if (rec.state === "recording") rec.stop();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  try {
    const blob = await stopped;
    return { blob, mime: blob.type || mime || "audio/webm" };
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    for (const t of stream.getTracks()) t.stop();
  }
}

export async function transcribeWithGrok(blob: Blob, mime: string, extraKeyterms: string[] = []): Promise<TranscribeResponse> {
  const audio_base64 = await blobToBase64(blob);
  return invoke<TranscribeResponse>("transcribe", {
    audio_base64,
    mime_type: mime.split(";")[0] || "audio/webm",
    keyterms: extraKeyterms.filter(Boolean).slice(0, 20),
  });
}

type SpeechRec = {
  lang: string;
  start: () => void;
  onresult: (e: { results: { transcript: string }[][] }) => void;
  onerror: () => void;
};

/** Live browser STT (Chrome/Edge). Used when we cannot record or Grok Voice is down. */
export function browserDictate(): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      reject(new Error("Grok Voice isn't available, and this browser has no speech recognition (try Chrome)."));
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.onresult = (e) => resolve(e.results[0][0].transcript);
    rec.onerror = () => reject(new Error("Voice recognition failed. Try again or type it."));
    rec.start();
  });
}

export function grokVoiceUnavailable(e: unknown): boolean {
  if (!(e instanceof InvokeError)) return false; // local errors (short clip, mic) stay as errors
  return !e.fromFunction || e.status === undefined || e.status === 401 || e.status >= 500;
}
