import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALIBRATION_MS,
  chooseTakeOutcome,
  createLevelTracker,
  trackLevel,
  isInfraTranscribeFailure,
  isPhone,
  isSpeechLevel,
  nextNoiseFloor,
  shouldRunParallelStt,
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

test("loud room: steady background noise stops counting as speech", () => {
  let floor: number | null = null;
  for (let i = 0; i < 30; i++) floor = nextNoiseFloor(floor, 0.06); // expo hum, above the 0.03 fixed threshold
  assert.ok(isSpeechLevel(0.06), "old fixed threshold would call this speech");
  assert.equal(isSpeechLevel(0.06, floor!), false);
  assert.equal(isSpeechLevel(0.2, floor!), true, "a voice over the hum still counts");
});

test("noise floor falls fast when the room quiets and rises slowly while talking", () => {
  let floor = 0.1;
  for (let i = 0; i < 10; i++) floor = nextNoiseFloor(floor, 0.01);
  assert.ok(floor < 0.02, `floor should drop quickly, got ${floor}`);
  let talking = 0.01;
  for (let i = 0; i < 25; i++) talking = nextNoiseFloor(talking, 0.3); // 2.5s of speech
  assert.ok(isSpeechLevel(0.3, talking), `a sentence shouldn't raise the floor past itself, floor ${talking}`);
});

test("quiet room keeps the absolute minimum threshold", () => {
  assert.equal(isSpeechLevel(0.02, 0.001), false);
  assert.equal(isSpeechLevel(SPEECH_RMS_THRESHOLD, 0.001), true);
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

test("heard text survives any transcribe failure, not just server errors", () => {
  const heard = "I'm Priya, nothing over $25";
  assert.deepEqual(chooseTakeOutcome({ grokText: "", grokFailed: true, infra: false, browserText: heard }), { kind: "browser", text: heard });
  assert.deepEqual(chooseTakeOutcome({ grokText: "", grokFailed: true, infra: true, browserText: heard }), { kind: "browser", text: heard });
  assert.deepEqual(chooseTakeOutcome({ grokText: "", grokFailed: false, infra: false, browserText: heard }), { kind: "browser", text: heard });
});

test("Grok text wins; nothing heard re-listens only on infra failure", () => {
  assert.deepEqual(chooseTakeOutcome({ grokText: " $25 ", grokFailed: false, infra: false, browserText: "25" }), { kind: "grok", text: "$25" });
  assert.deepEqual(chooseTakeOutcome({ grokText: "", grokFailed: true, infra: true, browserText: "" }), { kind: "relisten" });
  assert.deepEqual(chooseTakeOutcome({ grokText: "", grokFailed: true, infra: false, browserText: "  " }), { kind: "error" });
});

test("parallel mic mode is off on phones unless forced", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile";
  const ipadOs = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
  const mac = ipadOs;
  assert.equal(isPhone(iphone), true);
  assert.equal(isPhone(android), true);
  assert.equal(isPhone(ipadOs, 5), true);
  assert.equal(isPhone(mac, 0), false);
  assert.equal(shouldRunParallelStt(undefined, true), false);
  assert.equal(shouldRunParallelStt("", false), true);
  assert.equal(shouldRunParallelStt("on", true), true);
  assert.equal(shouldRunParallelStt("OFF", false), false);
});

test("only infra transcribe failures fall back to browser STT", () => {
  assert.equal(isInfraTranscribeFailure(false, 404), true);
  assert.equal(isInfraTranscribeFailure(true, undefined), true);
  assert.equal(isInfraTranscribeFailure(true, 401), true);
  assert.equal(isInfraTranscribeFailure(true, 502), true);
  assert.equal(isInfraTranscribeFailure(true, 400), false);
  assert.equal(isInfraTranscribeFailure(true, 422), false);
});

test("cold start: dead frames from a warming-up mic don't zero the floor, so room noise isn't speech", () => {
  const t = createLevelTracker();
  let now = 0;
  let spoke = false;
  for (let i = 0; i < 5; i++, now += 100) spoke ||= trackLevel(t, 0, now); // 500ms of digital silence
  for (let i = 0; i < 30; i++, now += 100) spoke ||= trackLevel(t, 0.04, now); // steady room hum above 0.03
  assert.equal(spoke, false);
  assert.ok(t.floor !== null && t.floor > 0.03);
  assert.equal(trackLevel(t, 0.25, now), true); // real speech still detected
});

test("cold start: talking right away still counts, and doesn't inflate the calibrated floor", () => {
  const t = createLevelTracker();
  let now = 0;
  const heard: boolean[] = [];
  const levels = [0.01, 0.2, 0.25, 0.01, 0.2, 0.01];
  for (const l of levels) { heard.push(trackLevel(t, l, now)); now += 100; }
  assert.equal(heard[1], true);
  assert.ok(now >= CALIBRATION_MS);
  assert.ok((t.floor ?? 1) < 0.03);
  assert.equal(trackLevel(t, 0.01, now + 100), false);
});
