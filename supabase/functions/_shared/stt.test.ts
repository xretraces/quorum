// deno test --node-modules-dir=none supabase/functions/_shared/stt.test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { buildKeyterms, decodeAudioBase64, mimeToFilename, PLANNING_KEYTERMS } from "./stt.ts";

Deno.test("mimeToFilename maps MediaRecorder types to xAI containers", () => {
  assertEquals(mimeToFilename("audio/webm;codecs=opus"), "voice.webm");
  assertEquals(mimeToFilename("audio/mp4"), "voice.mp4");
  assertEquals(mimeToFilename("audio/ogg;codecs=opus"), "voice.ogg");
  assertEquals(mimeToFilename("audio/wav"), "voice.wav");
  assertEquals(mimeToFilename("mystery/x"), "voice.webm");
});

Deno.test("buildKeyterms de-dupes, trims, and stays within xAI limits", () => {
  const terms = buildKeyterms(["  Maya  ", "maya", "A".repeat(80), "Priya"]);
  assertEquals(terms.includes("Maya"), true);
  assertEquals(terms.filter((t) => t.toLowerCase() === "maya").length, 1);
  assertEquals(terms.every((t) => t.length <= 50), true);
  assertEquals(terms.length <= 100, true);
  assertEquals(terms.includes("vegetarian"), true);
  assertEquals(PLANNING_KEYTERMS.length > 10, true);
});

Deno.test("decodeAudioBase64 rejects empty, bad, and tiny payloads", () => {
  assertThrows(() => decodeAudioBase64(""), Error, "empty");
  assertThrows(() => decodeAudioBase64("%%%"), Error, "base64");
  assertThrows(() => decodeAudioBase64(btoa("short")), Error, "too short");
});
