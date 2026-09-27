import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isInfraTranscribeFailure,
  isSpeechLevel,
  joinTranscriptParts,
  mimeToFilename,
  nextDraftAfterSend,
  pickRecorderMime,
  RECORDER_MIME_CANDIDATES,
  rmsFromTimeDomain,
  shouldAutoStop,
  shouldRestartRecognition,
  SILENCE_MS,
  SPEECH_RMS_THRESHOLD,
} from "./voice-logic.ts";

test("prefers audio/mp4, then ogg/opus, then webm", () => {
  assert.deepEqual([...RECORDER_MIME_CANDIDATES], [
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/webm;codecs=opus",
    "audio/webm",
  ]);
  assert.equal(pickRecorderMime((t) => t === "audio/webm" || t === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecorderMime((t) => t.startsWith("audio/ogg") || t.includes("webm")), "audio/ogg;codecs=opus");
  assert.equal(pickRecorderMime((t) => t === "audio/webm"), "audio/webm");
  assert.equal(pickRecorderMime(() => false), "");
});

test("filename extension matches the recorded container", () => {
  assert.equal(mimeToFilename("audio/mp4"), "voice.mp4");
  assert.equal(mimeToFilename("audio/ogg;codecs=opus"), "voice.ogg");
  assert.equal(mimeToFilename("audio/webm;codecs=opus"), "voice.webm");
  assert.equal(mimeToFilename("audio/webm"), "voice.webm");
  assert.equal(mimeToFilename("mystery/x"), "voice.mp4");
});

test("RMS: silence is quiet, a swing looks like speech", () => {
  const silence = Uint8Array.from({ length: 32 }, () => 128);
  const speech = Uint8Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 255 : 1));
  assert.ok(rmsFromTimeDomain(silence) < SPEECH_RMS_THRESHOLD);
  assert.ok(!isSpeechLevel(rmsFromTimeDomain(silence)));
  assert.ok(rmsFromTimeDomain(speech) >= SPEECH_RMS_THRESHOLD);
  assert.ok(isSpeechLevel(rmsFromTimeDomain(speech)));
  assert.equal(rmsFromTimeDomain(new Uint8Array()), 0);
});

test("auto-stop waits until they have spoken, then 2.5s of silence", () => {
  const t0 = 1_000_000;
  assert.equal(shouldAutoStop({ heardSpeech: false, lastSpeechAt: null, now: t0 + 10_000 }), false);
  assert.equal(shouldAutoStop({ heardSpeech: true, lastSpeechAt: t0, now: t0 + SILENCE_MS - 1 }), false);
  assert.equal(shouldAutoStop({ heardSpeech: true, lastSpeechAt: t0, now: t0 + SILENCE_MS }), true);
  assert.equal(shouldAutoStop({ heardSpeech: true, lastSpeechAt: t0, now: t0 + 400, silenceMs: 2500 }), false);
});

test("browser recognition restarts only when the take is still open", () => {
  assert.equal(shouldRestartRecognition({ settled: false, aborted: false, reachedMax: false, silenced: false }), true);
  assert.equal(shouldRestartRecognition({ settled: true, aborted: false, reachedMax: false, silenced: false }), false);
  assert.equal(shouldRestartRecognition({ settled: false, aborted: true, reachedMax: false, silenced: false }), false);
  assert.equal(shouldRestartRecognition({ settled: false, aborted: false, reachedMax: true, silenced: false }), false);
  assert.equal(shouldRestartRecognition({ settled: false, aborted: false, reachedMax: false, silenced: true }), false);
});

test("joinTranscriptParts keeps finals + trailing interim words", () => {
  assert.equal(joinTranscriptParts(["I'm Priya,", " nothing over twenty-five"]), "I'm Priya, nothing over twenty-five");
  assert.equal(joinTranscriptParts(["", "  ", "no car"]), "no car");
});

test("voice posts keep the typed draft; Send clears it", () => {
  assert.equal(nextDraftAfterSend("bowling after 6", false), "bowling after 6");
  assert.equal(nextDraftAfterSend("bowling after 6", true), "");
});

test("only infra transcribe failures fall back to browser STT", () => {
  assert.equal(isInfraTranscribeFailure(false, 404), true);
  assert.equal(isInfraTranscribeFailure(true, undefined), true);
  assert.equal(isInfraTranscribeFailure(true, 401), true);
  assert.equal(isInfraTranscribeFailure(true, 502), true);
  assert.equal(isInfraTranscribeFailure(true, 400), false);
  assert.equal(isInfraTranscribeFailure(true, 422), false);
});
