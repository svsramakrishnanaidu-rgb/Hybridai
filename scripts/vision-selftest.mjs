/**
 * HYDRO AI — gesture recognition self-test.
 *
 * Runs the real classifier in src/lib/vision/gestures.ts against synthetic
 * 21-point hands. This checks the geometry, thresholds, temporal tracker and
 * cooldown behaviour; it does not claim anything about camera accuracy, which
 * needs a real device and a real person.
 *
 * Run with: npm run vision:test
 */

import { GestureTracker, readHand } from "../src/lib/vision/gestures.ts";
import {
  MAX_FRAME_CHARS,
  cameraBlock,
  normalizeCameraState,
  parseFrame,
  visionDirective,
} from "../src/core/vision-context.ts";
import { wantsVisualAnswer } from "../src/lib/vision/intent.ts";
import {
  PROACTIVE,
  READ_TEXT_QUESTION,
  SIGHT_BUDGET,
  SIGHT_QUESTION,
  frameQuality,
  observationQuestion,
  shouldComment,
  shouldObserve,
  signatureDelta,
  signatureFromLuma,
  signatureFromRgba,
} from "../src/lib/vision/sight.ts";

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

const FINGER_X = { index: -0.06, middle: -0.02, ring: 0.02, pinky: 0.06 };

function baseHand({ palmX = 0.5, palmY = 0.5 } = {}) {
  const ox = palmX;
  const oy = palmY - 0.09;
  const pts = new Array(21);
  const set = (i, x, y) => {
    pts[i] = { x: ox + x, y: oy + y, z: 0 };
  };
  set(0, 0, 0.14); // wrist
  // thumb: 1..4
  set(1, 0.04, 0.10);
  set(2, 0.07, 0.08);
  set(3, 0.09, 0.06);
  set(4, 0.10, 0.03);
  // index..pinky: 5..20
  const order = ["index", "middle", "ring", "pinky"];
  order.forEach((finger, k) => {
    const x = FINGER_X[finger];
    const mcp = 5 + k * 4;
    set(mcp, x, 0.06);
    set(mcp + 1, x, 0.02);
    set(mcp + 2, x, 0.03);
    set(mcp + 3, x, 0.02);
  });
  return pts;
}

function extend(pts, finger) {
  const idx = ["index", "middle", "ring", "pinky"].indexOf(finger);
  const mcp = 5 + idx * 4;
  const x = FINGER_X[finger];
  const oy = pts[0].y - 0.14;
  pts[mcp + 1] = { x: pts[0].x + x, y: oy + 0.0, z: 0 };
  pts[mcp + 2] = { x: pts[0].x + x, y: oy - 0.03, z: 0 };
  pts[mcp + 3] = { x: pts[0].x + x, y: oy - 0.06, z: 0 };
  return pts;
}

function frame(landmarks, score = 0.95) {
  return { landmarks, handedness: "Right", score };
}

/** Thumb joints are placed relative to the wrist, like the rest of the hand. */
function setThumb(pts, { mcp, joint, tip }) {
  const ox = pts[0].x;
  const oy = pts[0].y - 0.14;
  pts[2] = { x: ox + mcp[0], y: oy + mcp[1], z: 0 };
  pts[3] = { x: ox + joint[0], y: oy + joint[1], z: 0 };
  pts[4] = { x: ox + tip[0], y: oy + tip[1], z: 0 };
  return pts;
}

// ── static poses ───────────────────────────────────────────────────────────
{
  const fist = readHand(frame(baseHand()));
  check("fist is not classified as a command", fist !== null && fist.gesture === null);

  let palm = baseHand();
  for (const f of ["index", "middle", "ring", "pinky"]) palm = extend(palm, f);
  const palmReading = readHand(frame(palm));
  check("open palm recognised", palmReading?.gesture === "open_palm", palmReading?.gesture);
  check("open palm confidence is usable", (palmReading?.confidence ?? 0) > 0.6, String(palmReading?.confidence));

  const pointed = extend(baseHand(), "index");
  check("point recognised", readHand(frame(pointed))?.gesture === "point");

  const thumbUp = setThumb(baseHand(), {
    mcp: [0.05, 0.02],
    joint: [0.04, -0.04],
    tip: [0.03, -0.10],
  });
  check("thumbs up recognised", readHand(frame(thumbUp))?.gesture === "thumbs_up", readHand(frame(thumbUp))?.gesture);

  const thumbDown = setThumb(baseHand(), {
    mcp: [0.05, 0.16],
    joint: [0.04, 0.22],
    tip: [0.03, 0.28],
  });
  check("thumbs down recognised", readHand(frame(thumbDown))?.gesture === "thumbs_down", readHand(frame(thumbDown))?.gesture);

  const pinch = baseHand();
  pinch[4] = { x: pinch[8].x + 0.005, y: pinch[8].y, z: 0 };
  check("pinch recognised", readHand(frame(pinch))?.gesture === "pinch");

  check("missing landmarks are rejected", readHand({ landmarks: [], handedness: "Right", score: 1 }) === null);
}

// ── temporal gestures ──────────────────────────────────────────────────────
{
  const tracker = new GestureTracker();
  const open = (x) => {
    let h = baseHand({ palmX: x, palmY: 0.55 });
    for (const f of ["index", "middle", "ring", "pinky"]) h = extend(h, f);
    return frame(h);
  };
  let events = [];
  for (let i = 0; i < 14; i++) {
    events.push(...tracker.push([open(i % 2 === 0 ? 0.44 : 0.60)], 1000 + i * 55));
  }
  check(
    "waving emits a wave",
    events.some((e) => e.name === "wave"),
    events.map((e) => e.name).join(","),
  );
}

{
  const tracker = new GestureTracker();
  const palm = (x) => {
    let h = baseHand({ palmX: x, palmY: 0.55 });
    for (const f of ["index", "middle", "ring", "pinky"]) h = extend(h, f);
    return frame(h);
  };
  let events = [];
  for (let i = 0; i < 8; i++) {
    events.push(...tracker.push([palm(0.78 - i * 0.055)], 2000 + i * 60));
  }
  check(
    "fast horizontal sweep emits a swipe",
    events.some((e) => e.name === "swipe_left" || e.name === "swipe_right"),
    events.map((e) => e.name).join(","),
  );
}

{
  const tracker = new GestureTracker();
  const raised = (() => {
    let h = baseHand({ palmX: 0.5, palmY: 0.3 });
    for (const f of ["index", "middle", "ring", "pinky"]) h = extend(h, f);
    return frame(h);
  })();
  let events = [];
  for (let i = 0; i < 8; i++) events.push(...tracker.push([raised], 3000 + i * 70));
  check(
    "held raised hand requests attention",
    events.some((e) => e.name === "raised_hand"),
    events.map((e) => e.name).join(","),
  );
}

{
  // two hands moving apart
  const tracker = new GestureTracker();
  const open = (x) => {
    let h = baseHand({ palmX: x, palmY: 0.55 });
    for (const f of ["index", "middle", "ring", "pinky"]) h = extend(h, f);
    return frame(h);
  };
  let events = [];
  for (let i = 0; i < 8; i++) {
    const gap = 0.06 + i * 0.04;
    events.push(...tracker.push([open(0.5 - gap), open(0.5 + gap)], 4000 + i * 80));
  }
  check(
    "two-hand separation emits expand",
    events.some((e) => e.name === "two_hand_expand"),
    events.map((e) => e.name).join(","),
  );
}

// ── safety behaviour ───────────────────────────────────────────────────────
{
  const tracker = new GestureTracker();
  const thumbUp = setThumb(baseHand(), {
    mcp: [0.05, 0.02],
    joint: [0.04, -0.04],
    tip: [0.03, -0.10],
  });
  const f = frame(thumbUp);
  const first = tracker.push([f], 5000);
  const second = tracker.push([f], 5100);
  check("cooldown suppresses repeated gestures", first.length === 1 && second.length === 0);
}

{
  const tracker = new GestureTracker({ threshold: 0.95 });
  const thumbUp = setThumb(baseHand(), {
    mcp: [0.05, 0.02],
    joint: [0.04, -0.04],
    tip: [0.03, -0.10],
  });
  const events = tracker.push([frame(thumbUp, 0.2)], 6000);
  check("low-confidence readings never fire an action", events.length === 0, `${events.length} event(s)`);
}

// ── continuous-sight policy ────────────────────────────────────────────────
{
  const dark = signatureFromLuma(new Array(144).fill(0.1));
  const same = signatureFromLuma(new Array(144).fill(0.1));
  const bright = signatureFromLuma(new Array(144).fill(0.6));
  check("identical frames have zero delta", signatureDelta(dark, same) === 0);
  check(
    "a lit scene registers a change",
    signatureDelta(dark, bright) > SIGHT_BUDGET.sceneThreshold,
    String(signatureDelta(dark, bright)),
  );

  const rgba = new Uint8ClampedArray(16 * 9 * 4);
  for (let i = 0; i < 16 * 9; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
  }
  check("white RGBA becomes a bright signature", signatureFromRgba(rgba).mean > 0.99);

  const base = {
    enabled: true,
    busy: false,
    now: 1_000_000,
    lastSentAt: null,
    observations: 0,
    delta: 0,
  };
  check("first frame is analysed", shouldObserve(base).reason === "first-frame");
  check(
    "unchanged scene costs nothing",
    shouldObserve({ ...base, lastSentAt: 900_000, observations: 1, delta: 0.01 }).reason === "unchanged",
  );

  const changed = { ...base, lastSentAt: 900_000, observations: 1, delta: 0.4 };
  check("a change during cooldown waits", shouldObserve({ ...changed, now: 905_000 }).reason === "cooldown");
  check("a change after cooldown is analysed", shouldObserve({ ...changed, now: 920_000 }).reason === "scene-change");
  check(
    "the per-session cap stops observations",
    shouldObserve({ ...changed, observations: SIGHT_BUDGET.maxObservations }).reason === "budget",
  );
  check("disabled sight never observes", shouldObserve({ ...changed, enabled: false }).reason === "disabled");
  check("an in-flight look is never doubled", shouldObserve({ ...changed, busy: true }).reason === "busy");
}

console.log("\nmeasured image quality");
{
  const dim = frameQuality({ cells: [0.02, 0.04, 0.05, 0.03], mean: 0.035 });
  check("a dark frame is reported as dim", dim.level === "dim" && Boolean(dim.note), dim.level);

  const bright = frameQuality({ cells: [0.95, 0.99, 0.97], mean: 0.97 });
  check("a blown-out frame is reported", bright.level === "bright", bright.level);

  const flat = frameQuality({ cells: [0.5, 0.51, 0.5, 0.505], mean: 0.504 });
  check("a flat frame is reported", flat.level === "flat", flat.level);

  const good = frameQuality({ cells: [0.1, 0.6, 0.9, 0.3], mean: 0.47 });
  check("a normal frame has no warning", good.level === "good" && good.note === null, good.level);

  check(
    "the measured light is added to the model question",
    observationQuestion(dim).includes("brightness") && observationQuestion(dim).length > SIGHT_QUESTION.length,
  );
  check("a good frame adds nothing to the question", observationQuestion(good) === SIGHT_QUESTION);
  check("no measurement means the plain question", observationQuestion(null) === SIGHT_QUESTION);
  check("the reading question asks for legible text only", /legible/i.test(READ_TEXT_QUESTION));
}

console.log("\nproactive comment policy");
{
  const base = {
    mode: "comment",
    busy: false,
    now: 100_000,
    lastCommentAt: null,
    comments: 0,
    delta: 0.4,
  };
  check("a real scene change may be commented", shouldComment(base));
  check("silent mode never comments", !shouldComment({ ...base, mode: "assist" }));
  check("privacy mode never comments", !shouldComment({ ...base, mode: "off" }));
  check("nothing is said while the user waits for a reply", !shouldComment({ ...base, busy: true }));
  check("an unchanged scene is not commented on", !shouldComment({ ...base, delta: 0.01 }));
  check(
    "the per-session comment budget is capped",
    !shouldComment({ ...base, comments: PROACTIVE.maxPerSession }),
  );
  check("comments respect the cooldown", !shouldComment({ ...base, lastCommentAt: base.now - 1000 }));
  check(
    "comments resume after the cooldown",
    shouldComment({ ...base, lastCommentAt: base.now - PROACTIVE.minIntervalMs }),
  );
}

console.log("\ncamera frame contract");
{
  const jpeg = `data:image/jpeg;base64,${Buffer.from("frame-bytes").toString("base64")}`;
  const parsed = parseFrame(jpeg);
  check("a valid JPEG data URL is accepted", parsed?.mimeType === "image/jpeg", parsed?.mimeType);
  check("the data-url prefix is stripped", parsed?.data === Buffer.from("frame-bytes").toString("base64"));
  check(
    "PNG and WebP are accepted",
    parseFrame(`data:image/png;base64,${parsed.data}`)?.mimeType === "image/png" &&
      parseFrame(`data:image/webp;base64,${parsed.data}`)?.mimeType === "image/webp",
  );
  check("a remote URL is not an image payload", parseFrame("https://example.com/a.jpg") === null);
  check("an SVG data URL is rejected", parseFrame(`data:image/svg+xml;base64,${parsed.data}`) === null);
  check("a non-string is rejected", parseFrame({ data: "x" }) === null);
  check(
    "an oversized frame is rejected",
    parseFrame(`data:image/jpeg;base64,${'A'.repeat(MAX_FRAME_CHARS + 1)}`) === null,
  );
}

console.log("\nmeasured camera state");
{
  check("state without an active flag is rejected", normalizeCameraState({ presence: true }) === null);
  check("garbage is rejected", normalizeCameraState("live") === null);

  const live = normalizeCameraState({
    active: true,
    presence: true,
    faces: 99,
    hands: 1,
    gazeX: 4,
    light: "dim",
    gesture: "wave",
    frameAgeMs: 400,
  });
  check("face count is clamped", live?.faces === 8, String(live?.faces));
  check("gaze is clamped into −1…1", live?.gazeX === 1, String(live?.gazeX));
  check(
    "hand count is clamped at zero",
    normalizeCameraState({ active: true, hands: -3 })?.hands === 0,
  );
  check("a known gesture survives", live?.gesture === "wave");
  check("an unknown gesture is dropped", normalizeCameraState({ active: true, gesture: "<script>" })?.gesture === undefined);
  check("an unknown light level is dropped", normalizeCameraState({ active: true, light: "neon" })?.light === undefined);

  check("an off camera says so", cameraBlock(normalizeCameraState({ active: false })).includes("off"));
  const block = cameraBlock(live);
  check("the live block reports measured tracking", block.includes("live") && block.includes("person is in frame"));
  check("the block reports the gesture", block.includes("wave"));
}

console.log("\ncapability directive");
{
  const off = visionDirective({ camera: normalizeCameraState({ active: false }), observation: null, model: null });
  check("camera off is stated plainly", off.includes("camera is OFF") && off.includes("no visual input"));
  check("camera off forbids describing a scene", off.includes("Never describe"));

  const withFrame = visionDirective({
    camera: normalizeCameraState({ active: true, presence: true, faces: 1 }),
    observation: "A person in a blue shirt holds a mug.",
    model: "gemini-test",
  });
  check("a live camera with an observation grants sight", withFrame.includes("DO have visual input"));
  check(
    "the denial is explicitly forbidden",
    withFrame.includes("Never say that you have no camera"),
  );
  check("the analysing model is named", withFrame.includes("gemini-test"));
  check("image limits are stated", withFrame.includes("cannot see anything outside that frame"));
  check("identification is forbidden", withFrame.includes("Never identify the person"));

  const failed = visionDirective({
    camera: normalizeCameraState({ active: true }),
    observation: null,
    model: null,
    error: "The vision model could not answer that frame.",
  });
  check("a failed look forbids description", failed.includes("could not be analysed") && !failed.includes("DO have visual input"));
  check("a failed look offers a retry", failed.includes("retry"));

  const idle = visionDirective({
    camera: normalizeCameraState({ active: true, presence: true }),
    observation: null,
    model: null,
  });
  check("no frame means no visual claim", idle.includes("No frame was analysed"));
  check("local tracking is still reported", idle.includes("person is in frame"));
  check("the directive never carries image bytes", !/[A-Za-z0-9+/]{200,}/.test(withFrame));
}

console.log("\nvisual intent");
{
  const asked = [
    "Can you see me?",
    "what am i wearing",
    "what colour is my shirt?",
    "how many fingers am i showing",
    "what object am i holding",
    "can you see my hand",
    "read this document",
    "what is visible behind me",
  ];
  for (const q of asked) check(`visual: ${q}`, wantsVisualAnswer(q));

  const notAsked = [
    "I see your point",
    "explain recursion with a python example",
    "write a function that sorts a list",
    "see you later",
    "what is the capital of France?",
  ];
  for (const q of notAsked) check(`not visual: ${q}`, !wantsVisualAnswer(q));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
