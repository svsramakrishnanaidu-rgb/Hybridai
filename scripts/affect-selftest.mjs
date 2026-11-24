/**
 * HYDRO AI — affect layer self-test.
 *
 * Exercises the pure fusion, tone and ledger logic with synthetic inputs. No
 * microphone, camera or network is involved: a passing run proves the model
 * behaves as written, not that any real face was ever read.
 */

import assert from "node:assert/strict";
import {
  directiveFrom,
  episodeAge,
  estimatePitchHz,
  followUpPrompt,
  fuseAffect,
  newEpisode,
  normalizeAffect,
  pendingFollowUp,
  recommend,
  rememberEpisode,
  toneGuidance,
  MAX_EPISODES,
} from "../src/core/affect.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const now = 1_700_000_000_000;
const text = (value) => ({ text: value, now });
const smiling = {
  present: true,
  smile: 0.85,
  brow: 0.1,
  browDown: 0.05,
  squint: 0.15,
  jaw: 0.1,
  frown: 0.02,
};
const tense = {
  present: true,
  smile: 0.02,
  brow: 0.2,
  browDown: 0.75,
  squint: 0.4,
  jaw: 0.1,
  frown: 0.6,
};

console.log("pitch measurement");

test("a 200 Hz tone is measured within 3%", () => {
  const rate = 48_000;
  const samples = new Float32Array(2048);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin((2 * Math.PI * 200 * i) / rate);
  const hz = estimatePitchHz(samples, rate);
  assert.ok(Math.abs(hz - 200) / 200 < 0.03, `got ${hz}`);
});

test("a 120 Hz tone is measured within 3%", () => {
  const rate = 44_100;
  const samples = new Float32Array(2048);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 120 * i) / rate);
  const hz = estimatePitchHz(samples, rate);
  assert.ok(Math.abs(hz - 120) / 120 < 0.03, `got ${hz}`);
});

test("silence reports no pitch instead of a guess", () => {
  assert.equal(estimatePitchHz(new Float32Array(2048), 48_000), 0);
});

test("white noise reports no pitch", () => {
  const samples = new Float32Array(2048);
  let seed = 7;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    samples[i] = (seed / 2147483648 - 0.5) * 0.6;
  }
  assert.equal(estimatePitchHz(samples, 48_000), 0);
});

console.log("fusion");

test("no signals is uncertain and never claims a mood", () => {
  const read = fuseAffect({ now });
  assert.equal(read.confidence, 0);
  assert.equal(read.uncertain, true);
  assert.equal(read.tone, "neutral");
  assert.equal(read.mood, null);
});

test("neutral text alone stays low-confidence", () => {
  const read = fuseAffect(text("What is the capital of France?"));
  assert.ok(read.confidence < 0.5, `confidence ${read.confidence}`);
});

test("strained wording selects the supportive tone", () => {
  const read = fuseAffect(text("This is broken and I hate it, nothing works."));
  assert.equal(read.tone, "supportive");
});

test("upbeat wording is not treated as strain", () => {
  const read = fuseAffect(text("This is great, thank you, it works perfectly!"));
  assert.notEqual(read.tone, "supportive");
});

test("a serious topic always gets the supportive tone", () => {
  const read = fuseAffect(text("My father died last week and I cannot focus."));
  assert.equal(read.serious, true);
  assert.equal(read.tone, "supportive");
});

test("a self-report outranks a smiling face", () => {
  const read = fuseAffect({
    text: "fine",
    face: smiling,
    selfReport: { mood: "stressed", at: now },
    now,
  });
  assert.equal(read.tone, "supportive");
  assert.equal(read.mood, "stressed");
  assert.ok(read.stress > 0.5, `stress ${read.stress}`);
});

test("conflicting face and words are reported as uncertain", () => {
  const read = fuseAffect({ text: "This is broken and I hate it.", face: smiling, now });
  assert.equal(read.uncertain, true);
  assert.equal(read.checkIn, true);
});

test("a self-report suppresses the check-in question", () => {
  const read = fuseAffect({
    text: "This is broken and I hate it.",
    face: smiling,
    selfReport: { mood: "okay", at: now },
    now,
  });
  assert.equal(read.checkIn, false);
});

test("voice contributes activation but never polarity", () => {
  const read = fuseAffect({
    now,
    voice: {
      frames: 40,
      voicedRatio: 0.6,
      energy: 0.16,
      energyVar: 0.08,
      pitchHz: 190,
      pitchVar: 3.2,
      wordsPerMinute: 200,
    },
  });
  assert.ok(Math.abs(read.valence) < 1e-9, `valence ${read.valence}`);
  assert.ok(read.arousal > 0.5, `arousal ${read.arousal}`);
});

test("a tense face reads negative and activated", () => {
  const read = fuseAffect({ face: tense, now });
  assert.ok(read.valence < 0);
  assert.ok(read.arousal > 0.4);
  assert.ok(read.cues.some((cue) => cue.includes("brows drawn")));
});

test("posture cues are surfaced as approximate", () => {
  const read = fuseAffect({ face: { ...smiling, lean: 0.8, settle: 0.7 }, now });
  assert.ok(read.cues.some((cue) => cue.includes("leaning")));
  assert.ok(read.cues.some((cue) => cue.includes("sitting lower")));
});

test("a stale self-report is ignored", () => {
  const read = fuseAffect({
    text: "hello",
    selfReport: { mood: "sad", at: now - 60 * 60_000 },
    now,
  });
  assert.equal(read.mood, null);
  assert.notEqual(read.tone, "supportive");
});

test("directive payload is rounded and carries only four fields", () => {
  const read = fuseAffect({
    text: "This is broken and I hate it.",
    selfReport: { mood: "stressed", at: now },
    now,
  });
  const directive = directiveFrom(read);
  assert.deepEqual(Object.keys(directive).sort(), ["confidence", "mood", "stress", "tone"]);
  assert.equal(directive.tone, "supportive");
  assert.equal(directive.mood, "stressed");
});

console.log("prompt guidance");

test("supportive guidance forbids emotion claims", () => {
  const guidance = toneGuidance({ tone: "supportive", stress: 0.7, confidence: 0.8, mood: "stressed" });
  assert.match(guidance, /Never say you can see, detect, read or know their emotions/);
  assert.match(guidance, /not confirmed feelings/);
  assert.doesNotMatch(guidance, /you are (sad|depressed)/i);
});

test("the self-report is quoted, not reinterpreted", () => {
  const guidance = toneGuidance({ tone: "supportive", stress: 0.6, confidence: 0.9, mood: "sad" });
  assert.match(guidance, /set their own mood to "sad"/);
});

test("neutral tone adds no prompt text", () => {
  assert.equal(toneGuidance({ tone: "neutral", stress: 0, confidence: 0.5, mood: null }), "");
  assert.equal(toneGuidance(undefined), "");
});

console.log("untrusted directive");

test("invalid directives are rejected", () => {
  assert.equal(normalizeAffect(null), undefined);
  assert.equal(normalizeAffect("supportive"), undefined);
  assert.equal(normalizeAffect({ tone: "angry" }), undefined);
});

test("a valid directive is clamped to 0…1", () => {
  const directive = normalizeAffect({ tone: "playful", stress: 4, confidence: -2, mood: "good" });
  assert.equal(directive.tone, "playful");
  assert.equal(directive.stress, 1);
  assert.equal(directive.confidence, 0);
  assert.equal(directive.mood, "good");
});

test("an unknown mood becomes null", () => {
  assert.equal(normalizeAffect({ tone: "warm", mood: "furious" }).mood, null);
});

console.log("episode ledger");

const episode = (at, mood) => ({
  id: `e${at}`,
  at,
  mood,
  valence: -0.4,
  arousal: 0.6,
  confidence: 0.7,
  tone: "supportive",
  cues: ["brows drawn together"],
  topic: "exam stress",
});

test("new episodes go first and the list is bounded", () => {
  let list = [];
  for (let i = 0; i < MAX_EPISODES + 12; i++) list = rememberEpisode(list, episode(now + i, "okay"));
  assert.equal(list.length, MAX_EPISODES);
  assert.equal(list[0].at, now + MAX_EPISODES + 11);
});

test("newEpisode keeps the reading and a short excerpt", () => {
  const read = fuseAffect({ text: "I am so stressed about exams", now });
  const item = newEpisode(read, "I am so stressed about exams ".repeat(20), now);
  assert.equal(item.at, now);
  assert.ok(item.topic.length <= 90);
  assert.ok(item.tone);
});

test("a follow-up needs a real, recent self-report", () => {
  assert.equal(pendingFollowUp([], now), null);
  assert.equal(pendingFollowUp([episode(now - 5 * 60_000, "stressed")], now), null);
  assert.equal(pendingFollowUp([episode(now - 30 * 24 * 60 * 60_000, "stressed")], now), null);
  assert.equal(pendingFollowUp([episode(now - 3 * 60 * 60_000, "good")], now), null);
  const hit = pendingFollowUp([episode(now - 3 * 60 * 60_000, "stressed")], now);
  assert.ok(hit);
});

test("the follow-up prompt is phrased as the user's own request", () => {
  assert.match(followUpPrompt(episode(now, "stressed")), /I was stressed/);
});

test("episode age is human readable", () => {
  assert.equal(episodeAge(now - 30 * 60_000, now), "30 min ago");
  assert.equal(episodeAge(now - 5 * 60 * 60_000, now), "5 h ago");
  assert.equal(episodeAge(now - 24 * 60 * 60_000, now), "1 day ago");
});

console.log("recommendations");

test("strain offers the breathing exercise", () => {
  const read = fuseAffect({
    text: "I cannot cope with this deadline",
    selfReport: { mood: "stressed", at: now },
    now,
  });
  assert.ok(recommend(read).some((r) => r.id === "breathe"));
});

test("a calm, positive reading offers the trivia round instead", () => {
  const read = fuseAffect({ text: "okay, nice and quiet here", now });
  assert.ok(recommend(read).some((r) => r.id === "quiz"));
  assert.ok(!recommend(read).some((r) => r.id === "breathe"));
});

test("no recommendation is invented from nothing", () => {
  assert.deepEqual(recommend(fuseAffect({ now })), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
