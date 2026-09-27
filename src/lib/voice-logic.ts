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

/** Speech must be this many times louder than the room's noise floor. */
export const SPEECH_FLOOR_RATIO = 2.5;
/** Rolling noise floor: drops fast when the room quiets, rises slowly (~10s) so a talker doesn't inflate it. */
const FLOOR_FALL = 0.3;
const FLOOR_RISE = 0.01;

export function nextNoiseFloor(floor: number | null, rms: number): number {
  if (floor === null) return rms;
  return floor + (rms - floor) * (rms < floor ? FLOOR_FALL : FLOOR_RISE);
}

/**
 * Cold-start fix. A freshly opened mic (the first take of a page load especially) delivers a few hundred ms of
 * digital silence or an auto-gain ramp before real room sound. Seeding the floor from that first frame put it
 * near 0, so ordinary room noise counted as "speech", the take never auto-stopped (or stopped before they
 * talked), and it took ~10s for the floor to catch up. Now: dead frames are ignored, the first CALIBRATION_MS
 * of live audio sets the floor from a low percentile (so talking right away doesn't inflate it), and only
 * clearly loud audio counts as speech while calibrating.
 */
export const DEAD_FRAME_RMS = 0.002;
export const CALIBRATION_MS = 500;
const CALIBRATION_PERCENTILE = 0.2;

export type LevelTracker = { floor: number | null; startedAt: number | null; calib: number[]; calibrated: boolean };

/** `seedFloor`: the last take's floor, used only until this take's calibration finishes. */
export function createLevelTracker(seedFloor: number | null = null): LevelTracker {
  return { floor: seedFloor, startedAt: null, calib: [], calibrated: false };
}

function lowPercentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/** Feed one RMS reading. Returns true if this frame is speech. Mutates the tracker. */
export function trackLevel(t: LevelTracker, rms: number, now: number): boolean {
  if (rms < DEAD_FRAME_RMS) return false; // mic not live yet (or muted): never calibrate on it
  if (t.startedAt === null) t.startedAt = now;
  if (!t.calibrated) {
    if (now - t.startedAt < CALIBRATION_MS) {
      t.calib.push(rms);
      return rms >= Math.max(SPEECH_RMS_THRESHOLD * 2, (t.floor ?? 0) * SPEECH_FLOOR_RATIO);
    }
    t.calibrated = true;
    if (t.calib.length) t.floor = lowPercentile(t.calib, CALIBRATION_PERCENTILE);
    t.calib = [];
  }
  const speaking = t.floor !== null && isSpeechLevel(rms, t.floor);
  t.floor = nextNoiseFloor(t.floor, rms);
  return speaking;
}

export function isSpeechLevel(rms: number, noiseFloor = 0, threshold = SPEECH_RMS_THRESHOLD): boolean {
  return rms >= Math.max(threshold, noiseFloor * SPEECH_FLOOR_RATIO);
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

export type TakeOutcome =
  | { kind: "grok"; text: string }
  | { kind: "browser"; text: string }
  | { kind: "relisten" }
  | { kind: "error" };

/**
 * What to do once a recorded take is back from `transcribe`. Any text the browser already heard
 * wins over an error, whatever the error was. Only an infra failure with nothing heard re-listens.
 */
export function chooseTakeOutcome(input: { grokText: string; grokFailed: boolean; infra: boolean; browserText: string }): TakeOutcome {
  const grok = input.grokText.trim();
  if (grok) return { kind: "grok", text: grok };
  const heard = input.browserText.trim();
  if (heard) return { kind: "browser", text: heard };
  if (input.grokFailed && input.infra) return { kind: "relisten" };
  return { kind: "error" };
}

export function isPhone(userAgent: string, maxTouchPoints = 0): boolean {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1; // iPadOS reports as a Mac
}

/**
 * Run browser speech recognition alongside the recorder so a failed transcribe has a backup.
 * Phones can't share the mic reliably (silent Android recordings, a second iPhone prompt), so the
 * default is laptops only. VITE_VOICE_PARALLEL=on|off overrides it for device testing.
 */
export function shouldRunParallelStt(setting: string | undefined, phone: boolean): boolean {
  const s = (setting ?? "").trim().toLowerCase();
  if (s === "on") return true;
  if (s === "off") return false;
  return !phone;
}

/** Voice posts must not wipe a draft the user was still typing. */
export function nextDraftAfterSend(draft: string, clearDraft: boolean): string {
  return clearDraft ? "" : draft;
}
