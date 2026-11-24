/**
 * HYDRO AI — live interaction self-test.
 *
 * Exercises the real decision modules behind hands-free interaction: the mode
 * matrix, the gesture→command policy, silence-based utterance segmentation, the
 * echo/duplicate guards, spoken mode control and the head nod/shake tracker.
 *
 * It does NOT prove camera or microphone behaviour, transcription accuracy, or
 * that a browser will grant permissions. Those need a device; this file proves
 * the rules that decide what a signal is allowed to do.
 *
 * Run: npm run live:test
 */

import {
  COMMAND_LABELS,
  LIVE_MODES,
  MIN_GESTURE_CONFIDENCE,
  PRIVACY_MODE,
  PROACTIVE_TURN_INTERVAL_MS,
  PRESENT_QUESTION,
  SPEECH,
  SpeechSegmenter,
  availableCommands,
  cleanTranscript,
  decideGesture,
  decideSubmit,
  detectSpokenControl,
  echoOverlap,
  gesturePrompt,
  isCancelPhrase,
  isLikelyEcho,
  isLiveMode,
  modeSpec,
  presencePrompt,
} from "../src/lib/interaction/live.ts";
import { HeadGestureTracker } from "../src/lib/vision/head.ts";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── modes ─────────────────────────────────────────────────────────────────
console.log("\ninteraction modes");
{
  const ids = LIVE_MODES.map((m) => m.id);
  check("eight modes are defined", ids.length === 8, ids.join(","));
  check("mode ids are unique", new Set(ids).size === ids.length);
  check("manual is the fallback for an unknown mode", modeSpec("nonsense").id === "manual");
  check("privacy has no camera", !modeSpec("privacy").camera);
  check("privacy takes no looks", !modeSpec("privacy").looks);
  check("privacy never auto-submits", !modeSpec("privacy").autoSubmit);
  check("voice mode has no camera", !modeSpec("voice").camera);
  check("live mode has camera, mic and gestures", (() => {
    const m = modeSpec("live");
    return m.camera && m.mic && m.gestures && m.autoSubmit;
  })());
  check("observation never acts", !modeSpec("observation").autoAct);
  check("observation does not speak on its own", !modeSpec("observation").proactive);
  check("hands-free submits speech", modeSpec("hands-free").autoSubmit);
  check("live and hands-free are live sessions", isLiveMode("live") && isLiveMode("hands-free"));
  check("manual is not a live session", !isLiveMode("manual"));
  check("privacy is not a live session", !isLiveMode(PRIVACY_MODE));
  check("every mode has a hint", LIVE_MODES.every((m) => m.hint.length > 10));
}

// ── gesture policy ────────────────────────────────────────────────────────
console.log("\ngesture → command policy");
{
  const base = {
    gesture: "wave",
    confidence: 0.9,
    mode: "gesture",
    speaking: false,
    pendingApproval: false,
    now: 10_000,
    lastAt: null,
  };
  const wave = decideGesture(base);
  check("a wave greets in gesture mode", wave.run && wave.command === "greet");

  check(
    "pinch is not a command",
    decideGesture({ ...base, gesture: "pinch" }).reason === "unmapped",
  );
  check(
    "manual mode refuses gestures",
    decideGesture({ ...base, mode: "manual" }).reason === "mode",
  );
  check(
    "privacy refuses gestures",
    decideGesture({ ...base, mode: "privacy" }).reason === "mode",
  );
  check(
    "weak confidence is dropped",
    decideGesture({ ...base, confidence: MIN_GESTURE_CONFIDENCE - 0.01 }).reason === "confidence",
  );
  check(
    "a repeated gesture inside the cooldown is dropped",
    decideGesture({ ...base, lastAt: 9500 }).reason === "cooldown",
  );
  check(
    "the cooldown expires",
    decideGesture({ ...base, lastAt: 8000 }).run,
  );
  check(
    "open palm only pauses when speaking",
    decideGesture({ ...base, gesture: "open_palm", speaking: false }).reason === "nothing-to-pause",
  );
  check(
    "open palm stops speech",
    decideGesture({ ...base, gesture: "open_palm", speaking: true }).command === "pause-speech",
  );
  check(
    "a gesture cannot approve nothing",
    decideGesture({ ...base, gesture: "thumbs_up" }).reason === "nothing-pending",
  );
  check(
    "thumbs up approves a pending low-risk plan",
    decideGesture({
      ...base,
      gesture: "thumbs_up",
      pendingApproval: true,
      pendingRisk: "low",
    }).command === "approve",
  );
  check(
    "a high-risk plan is never gesture-approved",
    decideGesture({
      ...base,
      gesture: "thumbs_up",
      pendingApproval: true,
      pendingRisk: "high",
    }).reason === "needs-explicit-approval",
  );
  check(
    "thumbs down rejects a pending plan",
    decideGesture({
      ...base,
      gesture: "thumbs_down",
      pendingApproval: true,
      pendingRisk: "medium",
    }).command === "reject",
  );
  check(
    "pointing analyses the object",
    decideGesture({ ...base, gesture: "point" }).command === "analyze-object",
  );
  check(
    "a nod acknowledges",
    decideGesture({ ...base, gesture: "head_nod" }).command === "acknowledge",
  );
  check(
    "a head shake disagrees",
    decideGesture({ ...base, gesture: "head_shake" }).command === "disagree",
  );
  check(
    "vertical swipes scroll",
    decideGesture({ ...base, gesture: "swipe_up" }).command === "scroll-up" &&
      decideGesture({ ...base, gesture: "swipe_down" }).command === "scroll-down",
  );
  check(
    "closing two hands stops the session",
    decideGesture({ ...base, gesture: "two_hand_contract" }).command === "stop",
  );
  check(
    "a gesture is refused while HYDRO is busy",
    decideGesture({ ...base, busy: true }).reason === "busy",
  );
  check(
    "stop still gets through while busy",
    decideGesture({ ...base, gesture: "two_hand_contract", busy: true }).run,
  );
  check(
    "every command has a label",
    Object.values(COMMAND_LABELS).every((label) => typeof label === "string" && label.length > 2),
  );
  check("privacy offers no gesture commands", availableCommands("privacy").length === 0);
  check(
    "gesture mode offers approve",
    availableCommands("gesture").some((c) => c.command === "approve"),
  );
}

// ── speech segmentation ───────────────────────────────────────────────────
console.log("\nspeech segmentation");
{
  const segmenter = new SpeechSegmenter();
  check("starts silent", segmenter.push(0.001, 0) === null);
  check("one loud frame is not enough", segmenter.push(0.05, 100) === null);
  check("two loud frames start a recording", segmenter.push(0.05, 200) === "start");
  check("recording is reported", segmenter.recording === true);
  check("a short pause keeps recording", segmenter.push(0.001, 500) === null);
  // Keep speaking for another 700 ms, then stop: only then is it a real
  // utterance rather than a noise burst.
  segmenter.push(0.05, 900);
  segmenter.push(0.05, 1000);
  check("a long pause ends the utterance", segmenter.push(0.001, 1000 + SPEECH.endSilenceMs + 10) === "end");
  check("the segmenter is idle again", segmenter.recording === false);

  const short = new SpeechSegmenter();
  short.push(0.05, 0);
  short.push(0.05, 100);
  const tooShort = short.push(0.001, 100 + SPEECH.endSilenceMs + 1);
  check("a click-length burst is rejected", tooShort === "too-short", String(tooShort));

  const long = new SpeechSegmenter();
  long.push(0.05, 0);
  long.push(0.05, 100);
  const cut = long.push(0.05, SPEECH.maxUtteranceMs + 500);
  check("a very long utterance is cut, not lost", cut === "end");

  const noise = new SpeechSegmenter();
  check("quiet noise never starts", noise.push(0.004, 0) === null && noise.push(0.006, 100) === null);
}

// ── transcript acceptance ─────────────────────────────────────────────────
console.log("\ntranscript acceptance");
{
  const base = { mode: "voice", speaking: false, now: 20_000, echoText: "" };
  check("an empty transcript is dropped", decideSubmit({ ...base, text: "  " }).reason === "empty");
  check("manual mode never auto-submits", decideSubmit({ ...base, mode: "manual", text: "hello" }).reason === "mode");
  check("privacy never auto-submits", decideSubmit({ ...base, mode: "privacy", text: "hello" }).reason === "mode");
  check("a normal sentence is submitted", decideSubmit({ ...base, text: "what is the weather" }).submit);
  check(
    "cancel phrases cancel",
    decideSubmit({ ...base, text: "cancel that" }).reason === "cancel",
  );
  check("a single character is not a command", decideSubmit({ ...base, text: "." }).reason === "short");
  check(
    "nothing is submitted while HYDRO is speaking",
    decideSubmit({ ...base, speaking: true, text: "hello there" }).reason === "echo",
  );
  check(
    "an echo of HYDRO's own voice is dropped",
    decideSubmit({
      ...base,
      text: "the background is red and the word written on it is hydro",
      echoText: "the background is red and the word written on it is hydro",
    }).reason === "echo",
  );
  check(
    "a new question is not treated as an echo",
    decideSubmit({
      ...base,
      text: "what is the capital of telangana",
      echoText: "the background is red and the word written on it is hydro",
    }).submit,
  );
  check(
    "an exact repeat is not submitted twice",
    decideSubmit({
      ...base,
      text: "open the workspace",
      lastSubmitted: { text: "open the workspace", at: 18_000 },
    }).reason === "duplicate",
  );
  check(
    "the duplicate window expires",
    decideSubmit({
      ...base,
      text: "open the workspace",
      lastSubmitted: { text: "open the workspace", at: 2000 },
    }).submit,
  );
  check(
    "a reply in flight blocks a new command",
    decideSubmit({ ...base, text: "and also this", busy: true }).reason === "busy",
  );
  check("fillers are removed", cleanTranscript("um, so what is this") === "what is this");
  check("cancel phrases are recognised", isCancelPhrase("Never mind") && isCancelPhrase("stop listening"));
  check("a normal question is not a cancel", !isCancelPhrase("cancel my subscription tomorrow"));
  check("echo overlap measures words", Math.abs(echoOverlap("one two three", "one two other") - 2 / 3) < 1e-9);
  check("a short utterance is never an echo", !isLikelyEcho("hello", "hello hello hello hello"));
}

// ── spoken control ────────────────────────────────────────────────────────
console.log("\nspoken control");
{
  check("privacy mode by voice", detectSpokenControl("switch to privacy mode")?.mode === "privacy");
  check("live mode by voice", detectSpokenControl("go to live mode")?.mode === "live");
  check(
    "hands-free is a mode",
    detectSpokenControl("hands free")?.kind === "mode",
  );
  check("stop listening mutes the mic", detectSpokenControl("stop listening")?.kind === "stop-microphone");
  check("stop camera is separate", detectSpokenControl("camera off")?.kind === "stop-camera");
  check("emergency stop stops everything", detectSpokenControl("emergency stop")?.kind === "stop-all");
  check(
    "a long question is not a command",
    detectSpokenControl("can you explain how privacy mode works in this app and what it disables") === null,
  );
  check("ordinary speech is not a command", detectSpokenControl("what can you see") === null);
}

// ── prompts ───────────────────────────────────────────────────────────────
console.log("\nobservation prompts");
{
  check("the presentation question mentions pointing", /point|holding/i.test(PRESENT_QUESTION));
  check("the presentation question forbids identity", /do not identify people/i.test(PRESENT_QUESTION));
  check("presence prompt is a real request", presencePrompt().length > 20);
  check("gesture prompt carries the label", gesturePrompt("Wave").includes("Wave"));
  check("proactive turns are rate limited", PROACTIVE_TURN_INTERVAL_MS >= 30_000);
}

// ── head gestures ─────────────────────────────────────────────────────────
console.log("\nhead gestures");
{
  const tracker = new HeadGestureTracker();
  const steady = new HeadGestureTracker();
  let steadyEvent = null;
  for (let i = 0; i < 12; i++) {
    steadyEvent = steady.push({ yaw: 0.01, pitch: 0.01, present: true, at: i * 110 }) ?? steadyEvent;
  }
  check("a still head is not a gesture", steadyEvent === null);

  const nodValues = [0, 0.12, 0, -0.12, 0, 0.12, 0];
  let nodEvent = null;
  for (let i = 0; i < nodValues.length; i++) {
    nodEvent = tracker.push({ yaw: 0, pitch: nodValues[i], present: true, at: i * 100 }) ?? nodEvent;
  }
  check("a real nod is detected", nodEvent === "head_nod", String(nodEvent));

  const shake = new HeadGestureTracker();
  const shakeValues = [0, 0.15, 0, -0.15, 0, 0.15, 0];
  let shakeEvent = null;
  for (let i = 0; i < shakeValues.length; i++) {
    shakeEvent = shake.push({ yaw: shakeValues[i], pitch: 0, present: true, at: i * 100 }) ?? shakeEvent;
  }
  check("a real head shake is detected", shakeEvent === "head_shake", String(shakeEvent));

  const quiet = new HeadGestureTracker();
  let quietEvent = null;
  for (let i = 0; i < 10; i++) {
    quietEvent = quiet.push({ yaw: 0, pitch: 0, present: false, at: i * 100 }) ?? quietEvent;
  }
  check("an absent face never gestures", quietEvent === null);

  const latched = new HeadGestureTracker();
  let second = null;
  for (let i = 0; i < nodValues.length; i++) {
    latched.push({ yaw: 0, pitch: nodValues[i], present: true, at: i * 100 });
  }
  for (let i = 0; i < nodValues.length; i++) {
    second = latched.push({ yaw: 0, pitch: nodValues[i], present: true, at: 700 + i * 60 }) ?? second;
  }
  check("a second nod inside the cooldown is ignored", second === null, String(second));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
