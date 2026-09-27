// POST /functions/v1/transcribe
// { audio_base64: string, mime_type?: string, keyterms?: string[] }
// Browser records a short voice note; this function sends it to Grok Voice Transcribe
// (https://api.x.ai/v1/stt). The xAI key never ships to the client.
// Secrets: GROK_API_KEY (or XAI_API_KEY). Optional GROK_STT_MODEL (default grok-voice-transcribe-2.0).

import { HttpError, reqString, serveJson } from "../_shared/http.ts";
import { decodeAudioBase64, transcribeWithXai } from "../_shared/stt.ts";

function optStringArray(body: Record<string, unknown>, key: string): string[] {
  const v = body[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new HttpError(400, `\`${key}\` must be an array of strings`);
  }
  return (v as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 20);
}

Deno.serve(serveJson(async (body) => {
  const apiKey = Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY");
  if (!apiKey) throw new HttpError(500, "GROK_API_KEY (or XAI_API_KEY) secret is not set");

  const audioBase64 = reqString(body, "audio_base64");
  const mime = (typeof body.mime_type === "string" && body.mime_type.trim()) ? body.mime_type.trim() : "audio/webm";
  const extra = optStringArray(body, "keyterms");

  let bytes: Uint8Array;
  try {
    bytes = decodeAudioBase64(audioBase64);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Invalid audio");
  }

  try {
    const result = await transcribeWithXai({ apiKey, bytes, mime, keyterms: extra });
    if (!result.text) throw new HttpError(422, "Grok Voice heard silence. Try again and speak a bit longer.");
    return { text: result.text, language: result.language ?? "en", duration: result.duration ?? null, model: result.model };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, e instanceof Error ? e.message : "Grok Voice transcription failed");
  }
}));
