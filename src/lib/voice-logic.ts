// Pure voice-session rules. No DOM, no Supabase — safe to unit-test.

/** Preferred MediaRecorder types. xAI lists mp4/ogg clearly; webm is last because Android often picks it first. */
export const RECORDER_MIME_CANDIDATES = [
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export const MAX_RECORD_MS = 45_000;
export const SILENCE_MS = 2_500;
export const SPEECH_RMS_THRESHOLD = 0.03;

export function pickRecorderMime(isSupported: (mime: string) => boolean): string {
  return RECORDER_MIME_CANDIDATES.find((t) => isSupported(t)) ?? "";
}

/** Filename extension must match the container we actually recorded. */
export function mimeToFilename(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base.includes("mp4")) return "voice.mp4";
  if (base.includes("m4a") || base.includes("x-m4a")) return "voice.m4a";
  if (base.includes("aac")) return "voice.aac";
  if (base.includes("ogg")) return "voice.ogg";
  if (base.includes("webm")) return "voice.webm";
  if (base.includes("mpeg") || base.includes("mp3")) return "voice.mp3";
  if (base.includes("wav") || base.includes("wave")) return "voice.wav";
  if (base.includes("flac")) return "voice.flac";
  return "voice.mp4";
}

export function rmsFromTimeDomain(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

export function isSpeechLevel(rms: number, threshold = SPEECH_RMS_THRESHOLD): boolean {
  return rms >= threshold;
}

/** Auto-stop only after the person has started talking, then ~2.5s of silence. Mid-sentence pauses stay open. */
export function shouldAutoStop(input: {
  heardSpeech: boolean;
  lastSpeechAt: number | null;
  now: number;
  silenceMs?: number;
}): boolean {
  if (!input.heardSpeech || input.lastSpeechAt === null) return false;
  return input.now - input.lastSpeechAt >= (input.silenceMs ?? SILENCE_MS);
}

export function joinTranscriptParts(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Restart Web Speech if the browser ends the session before the user (or silence) finished. */
export function shouldRestartRecognition(input: {
  settled: boolean;
  aborted: boolean;
  reachedMax: boolean;
  silenced: boolean;
}): boolean {
  return !input.settled && !input.aborted && !input.reachedMax && !input.silenced;
}

/** Infra / undeployed `transcribe` — fall back to browser STT. 4xx business errors stay errors. */
export function isInfraTranscribeFailure(fromFunction: boolean, status: number | undefined): boolean {
  return !fromFunction || status === undefined || status === 401 || status >= 500;
}

/** Voice posts must not wipe a draft the user was still typing. */
export function nextDraftAfterSend(draft: string, clearDraft: boolean): string {
  return clearDraft ? "" : draft;
}
