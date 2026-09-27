// Grok Voice / xAI speech-to-text helpers used by the `transcribe` Edge Function.
// Docs: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
// Batch endpoint is POST https://api.x.ai/v1/stt (multipart). The API key never leaves the server.

import { CATALOG_FILE } from "./catalog.ts";

export const STT_URL = "https://api.x.ai/v1/stt";
export const DEFAULT_STT_MODEL = "grok-voice-transcribe-2.0";
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // 4 MB decoded — plenty for a ~45s voice note

/** Spoken budget/diet/transit slang + Atlanta catalog names. Max 100 terms, 50 chars each (xAI limit). */
export const PLANNING_KEYTERMS = [
  "dollars",
  "bucks",
  "budget",
  "max",
  "cap",
  "vegetarian",
  "vegan",
  "halal",
  "kosher",
  "gluten-free",
  "no pork",
  "no car",
  "transit",
  "MARTA",
  "rideshare",
  "BeltLine",
  "Atlanta",
  ...CATALOG_FILE.activities.map((a) => a.name),
];

export type SttWord = { text: string; start: number; end: number; speaker?: number };
export type SttResult = { text: string; language?: string; duration?: number; words?: SttWord[]; model: string };

export function buildKeyterms(extra: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...PLANNING_KEYTERMS, ...extra]) {
    const term = raw.trim().slice(0, 50);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= 100) break;
  }
  return out;
}

/** Map a MediaRecorder mime type to a filename so xAI can auto-detect the container. */
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

/** Decode a raw or data-URL base64 string. Throws if empty or over MAX_AUDIO_BYTES. */
export function decodeAudioBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!clean) throw new Error("audio_base64 is empty");
  let bin: string;
  try {
    bin = atob(clean);
  } catch {
    throw new Error("audio_base64 is not valid base64");
  }
  if (bin.length > MAX_AUDIO_BYTES) {
    throw new Error(`Audio is too large (${Math.round(bin.length / 1024)} KB). Keep voice notes under ~45 seconds.`);
  }
  if (bin.length < 200) throw new Error("Recording is too short. Speak a bit longer, then stop.");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function transcribeWithXai(opts: {
  apiKey: string;
  bytes: Uint8Array;
  mime: string;
  keyterms?: string[];
  model?: string;
}): Promise<SttResult> {
  const model = opts.model || Deno.env.get("GROK_STT_MODEL") || DEFAULT_STT_MODEL;
  const form = new FormData();
  form.append("format", "true"); // "thirty dollars" → "$30" (needs language)
  form.append("language", "en");
  form.append("model", model);
  form.append("filler_words", "false");
  for (const term of buildKeyterms(opts.keyterms ?? [])) {
    form.append("keyterm", term);
  }
  // `file` must be last — xAI ignores fields sent after it.
  const filename = mimeToFilename(opts.mime);
  form.append("file", new File([opts.bytes], filename, { type: opts.mime || "application/octet-stream" }));

  const res = await fetch(STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`xAI STT error ${res.status}: ${text.slice(0, 2000)}`);
  let data: { text?: unknown; language?: unknown; duration?: unknown; words?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("xAI STT returned non-JSON");
  }
  if (typeof data.text !== "string") throw new Error("xAI STT response had no text");
  return {
    text: data.text.trim(),
    language: typeof data.language === "string" ? data.language : undefined,
    duration: typeof data.duration === "number" ? data.duration : undefined,
    words: Array.isArray(data.words) ? data.words as SttWord[] : undefined,
    model,
  };
}
