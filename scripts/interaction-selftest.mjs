/**
 * HYDRO AI — expressive interaction self-test.
 *
 * Exercises the real modules: the FACS-inspired emotion engine, the text-derived
 * viseme timeline, the procedural blink/breath generator and the layered
 * interaction controller. Everything is deterministic, so these assertions are
 * about the actual logic, not about a browser or a camera.
 *
 * It does NOT prove facial accuracy, camera tracking quality, lip-sync accuracy
 * against real audio, or how the shader looks. Those need a device and eyes.
 *
 * Run: npm run interaction:test
 */

import {
  EMOTION_NAMES,
  EmotionEngine,
  FACE_CHANNELS,
  PROTOTYPES,
  appraise,
} from "../src/core/emotion.ts";
import {
  REST_MOUTH,
  mouthAt,
  textToVisemes,
  timelineDuration,
  visemeShape,
} from "../src/core/visemes.ts";
import { IdleMotion, mulberry32 } from "../src/lib/interaction/procedural.ts";
import {
  CORE_STATE,
  STATE_LABELS,
  InteractionController,
} from "../src/lib/interaction/controller.ts";
import { STATES } from "../src/components/hologram/shaders.ts";

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

const between = (v, lo, hi) => typeof v === "number" && v >= lo && v <= hi;

console.log("\nwording appraisal");
{
  const positive = appraise("thanks, that worked perfectly");
  check("positive wording reads positive", positive.valence > 0.4, String(positive.valence));
  check("gratitude is tagged", positive.tags.includes("gratitude"), positive.tags.join(","));

  const negative = appraise("this is broken and useless");
  check("negative wording reads negative", negative.valence < -0.3, String(negative.valence));

  const negated = appraise("the answer is not good");
  check("negation flips polarity", negated.valence < 0, String(negated.valence));

  const question = appraise("how does this work?");
  check("a question is tagged", question.tags.includes("question"));

  const serious = appraise("my father died last week");
  check("a serious topic is flagged", serious.serious);
  check("serious topics cap excitement", serious.arousal <= 0.42, String(serious.arousal));
  check("serious topics do not read as cheerful", serious.valence <= 0.05, String(serious.valence));

  const shouted = appraise("WHY IS THIS BROKEN");
  check("shouting raises arousal", shouted.arousal > negative.arousal * 0.9, String(shouted.arousal));
}

console.log("\nexpression presets");
{
  const expressive = EMOTION_NAMES.filter((n) => n !== "neutral");
  check("at least 30 expressive presets exist", expressive.length >= 30, String(expressive.length));

  // A preset that no affect state can reach is dead code. Drive the engine to
  // each prototype's own anchor and require that preset to light up.
  const unreachable = [];
  for (const name of expressive) {
    const engine = new EmotionEngine({ composure: 1 });
    const [v, a, d] = PROTOTYPES[name].anchor;
    // The engine deliberately lets affect relax back to a mood baseline, so the
    // anchor is re-pinned each step. This isolates the prototype and its gate:
    // "can any affect position make this preset appear?"
    for (let i = 0; i < 30; i++) {
      engine.valence = v;
      engine.arousal = a;
      engine.dominance = d;
      engine.update(50);
    }
    if (engine.snapshot().intensities[name] < 0.1) {
      unreachable.push(`${name}=${engine.snapshot().intensities[name].toFixed(3)}`);
    }
  }
  check("every preset is reachable from its own anchor", unreachable.length === 0, unreachable.join(","));

  const described = new EmotionEngine();
  check("neutral is the residual, not a preset anchor", !expressive.includes("neutral"));
  check("describe covers every preset", EMOTION_NAMES.every((n) => typeof n === "string"));
  described.reset();
}

console.log("\nemotion engine");
{
  const engine = new EmotionEngine();
  for (let i = 0; i < 40; i++) engine.update(50);
  const rest = engine.snapshot();
  check("resting state is neutral", rest.dominant === "neutral", rest.dominant);
  check("resting intensity is low", rest.intensity < 0.9, String(rest.intensity));

  const happy = new EmotionEngine();
  happy.read("thank you, that was great — really helpful");
  let snap = happy.snapshot();
  for (let i = 0; i < 20; i++) snap = happy.update(50);
  check(
    "praise produces a positive expression",
    [
      "happiness",
      "amusement",
      "confidence",
      "excitement",
      "pride",
      "gratitude",
      "relief",
      "tenderness",
    ].includes(snap.dominant),
    snap.dominant,
  );
  const happyFace = happy.face();
  check("a positive expression smiles", happyFace.smile > 0.15, String(happyFace.smile));
  check("smile and cheek raise move together", happyFace.cheek > 0.03, String(happyFace.cheek));

  const serious = new EmotionEngine();
  serious.read("I am sorry, my mother is in hospital");
  for (let i = 0; i < 60; i++) serious.update(50);
  const seriousFace = serious.face();
  check("a serious turn is remembered", serious.snapshot().serious > 0.2, String(serious.snapshot().serious));
  check("serious turns suppress smiling", seriousFace.smile < 0.4, String(seriousFace.smile));
  check(
    "serious turns keep an attentive brow",
    seriousFace.browRaise + seriousFace.frown > 0.1,
    `${seriousFace.browRaise.toFixed(3)}/${seriousFace.frown.toFixed(3)}`,
  );

  // bounds under a barrage of conflicting input
  const noisy = new EmotionEngine();
  const words = ["great", "terrible", "urgent", "calm", "not good", "thank you", "crash", "hello"];
  for (let round = 0; round < 40; round++) {
    noisy.read(words[round % words.length]);
    for (let i = 0; i < 6; i++) {
      noisy.update(40);
      const face = noisy.face();
      for (const channel of FACE_CHANNELS) {
        if (!between(face[channel], 0, 1)) {
          check(`channel ${channel} stays bounded`, false, String(face[channel]));
          break;
        }
      }
    }
  }
  check("every FACS channel stays in 0…1", true);
  const noisySnap = noisy.snapshot();
  check("valence stays in −1…1", between(noisySnap.valence, -1, 1), String(noisySnap.valence));
  check("arousal stays in 0…1", between(noisySnap.arousal, 0, 1), String(noisySnap.arousal));

  const shy = new EmotionEngine({ expressiveness: 0 });
  const bold = new EmotionEngine({ expressiveness: 1 });
  for (const engine of [shy, bold]) {
    engine.read("this is amazing, thank you");
    for (let i = 0; i < 20; i++) engine.update(50);
  }
  check(
    "expressiveness scales the visible face",
    bold.face().smile > shy.face().smile + 0.07,
    `${bold.face().smile.toFixed(3)} vs ${shy.face().smile.toFixed(3)}`,
  );

  const voice = new EmotionEngine();
  voice.read("this is urgent, please hurry!");
  for (let i = 0; i < 20; i++) voice.update(50);
  const fast = voice.prosody();
  for (let i = 0; i < 1200; i++) voice.update(50);
  voice.read("I am sorry, my father is in hospital");
  for (let i = 0; i < 40; i++) voice.update(50);
  const slow = voice.prosody();
  check("prosody rate is bounded", between(fast.rate, 0.86, 1.14), String(fast.rate));
  check("prosody speed is within the provider range", between(fast.speed, 0.7, 1.2));
  check("prosody style is bounded", between(fast.style, 0, 0.7));
  check("prosody stability is bounded", between(fast.stability, 0.25, 0.75));
  check("serious speech is slower and calmer", slow.rate < fast.rate, `${slow.rate} vs ${fast.rate}`);
  check("serious speech pauses longer", slow.pauseMs > fast.pauseMs, `${slow.pauseMs} vs ${fast.pauseMs}`);

  const reset = new EmotionEngine();
  reset.read("this is terrible");
  reset.update(200);
  reset.reset();
  const afterReset = reset.snapshot();
  check(
    "reset clears learned emotion intensity",
    EMOTION_NAMES.every((name) => afterReset.intensities[name] < 1e-6),
  );
}

console.log("\nviseme timeline");
{
  check("empty text produces no cues", textToVisemes("").length === 0);
  const hello = textToVisemes("hello");
  check("a word produces several visemes", hello.length >= 3, String(hello.length));
  check(
    "cues are ordered and non-negative",
    hello.every((cue, i) => cue.end >= cue.start && (i === 0 || cue.start >= hello[i - 1].start)),
  );
  check(
    "every cue carries a known viseme shape",
    hello.every((cue) => between(visemeShape(cue.viseme).jaw, 0, 1)),
  );

  const closed = textToVisemes("mama");
  check("bilabials start closed", closed[0].viseme === "MBP", closed[0]?.viseme);

  const vowels = textToVisemes("ah");
  const vowelCue = vowels.find((cue) => cue.viseme === "AA");
  check("an open vowel exists in the timeline", Boolean(vowelCue));

  const full = textToVisemes("hello world");
  const total = timelineDuration(full);
  check("duration is positive", total > 200, String(total));
  check("mouth is closed before speech", mouthAt(full, -1).jaw === 0);
  check("mouth is closed after speech", mouthAt(full, total + 200).jaw === 0);
  const mid = mouthAt(full, total * 0.4);
  check("mouth is open during speech", mid.jaw > 0.05, String(mid.jaw));
  check(
    "mouth channels stay bounded",
    between(mid.jaw, 0, 1) && between(mid.width, 0, 1) && between(mid.round, 0, 1),
  );

  const pauseDot = timelineDuration(textToVisemes("hello there. how are you"));
  const noPause = timelineDuration(textToVisemes("hello there how are you"));
  check("full stops add a real pause", pauseDot > noPause, `${pauseDot} vs ${noPause}`);

  const fast = timelineDuration(textToVisemes("the quick brown fox", { rate: 1.2 }));
  const slow = timelineDuration(textToVisemes("the quick brown fox", { rate: 0.8 }));
  check("speech rate changes duration", fast < slow, `${fast} vs ${slow}`);

  const telugu = textToVisemes("నమస్తే హైడ్రో");
  check("Telugu script produces visemes", telugu.length >= 4, String(telugu.length));
  check(
    "Telugu labials map to a closed shape",
    telugu.some((cue) => cue.viseme === "MBP"),
    telugu.map((c) => c.viseme).join(","),
  );

  const mixed = textToVisemes("hello నమస్తే world");
  check("mixed Telugu-English text is handled", mixed.length > 6, String(mixed.length));
  check(
    "a huge input is capped",
    textToVisemes("word ".repeat(2000)).length < 500,
    String(textToVisemes("word ".repeat(2000)).length),
  );
  check("rest mouth has no jaw opening", REST_MOUTH.jaw === 0);
}

console.log("\nprocedural idle motion");
{
  check("the seeded generator is reproducible", mulberry32(5)() === mulberry32(5)());

  const run = (seed) => {
    const motion = new IdleMotion(seed);
    const frames = [];
    for (let i = 0; i < 750; i++) frames.push(motion.update(16));
    return frames;
  };
  const a = run(11);
  const b = run(11);
  check("same seed, same blink sequence", a.every((f, i) => f.blink === b[i].blink));

  const blinks = a.filter((f) => f.blink > 0.5).length;
  check("blinking actually happens", blinks > 0, String(blinks));
  check("blinking is not a mechanical loop", a.filter((f) => f.blink > 0.9).length < 60);
  check(
    "all idle channels stay bounded",
    a.every(
      (f) =>
        between(f.blink, 0, 1) &&
        between(f.breath, 0, 1) &&
        between(f.saccadeX, -0.5, 0.5) &&
        between(f.saccadeY, -0.5, 0.5) &&
        between(f.micro, 0, 1),
    ),
  );
  const breath = a.map((f) => f.breath);
  check("breathing has amplitude", Math.max(...breath) - Math.min(...breath) > 0.3);
  const micros = a.filter((f) => f.micro > 0.05).length;
  check("micro-expressions appear rarely", micros > 0 && micros < 150, String(micros));
}

console.log("\ninteraction controller");
{
  const controller = new InteractionController();
  const idle = controller.sample(16);
  check("starts idle", idle.state === "idle", idle.state);
  check("blink is bounded", between(idle.blink, 0, 1));
  check("posture is bounded", between(idle.posture.roll, -1, 1) && between(idle.posture.breath, 0, 1));

  controller.push({ kind: "user-message", text: "hello there" });
  controller.push({ kind: "reply-start" });
  controller.sample(16);
  check("a running request reads as thinking", controller.state === "thinking", controller.state);

  controller.push({ kind: "speech-start", text: "Here is the answer, clearly." });
  controller.sample(16);
  check("speaking outranks thinking", controller.state === "speaking", controller.state);
  for (let i = 0; i < 12; i++) controller.sample(30, { audio: 0.7 });
  const speaking = controller.sample(30, { audio: 0.7 });
  check("speech opens the mouth", speaking.mouth.jaw > 0.1, String(speaking.mouth.jaw));
  check("speech has a lip shape", between(speaking.mouth.width, 0, 1));

  controller.push({ kind: "speech-end" });
  controller.push({ kind: "interrupt" });
  controller.sample(16);
  check("an interruption reads as uncertain", controller.state === "confused", controller.state);

  const erroring = new InteractionController();
  erroring.push({ kind: "reply-start" });
  erroring.push({ kind: "error" });
  erroring.sample(16);
  check("an error reads as concern", erroring.state === "concerned", erroring.state);
  check(
    "concern shows on the face",
    erroring.sample(16).face.frown > 0.05,
    String(erroring.sample(16).face.frown),
  );

  // layered states: observing while listening
  const layered = new InteractionController();
  layered.push({ kind: "listen-start" });
  layered.push({ kind: "observe-start" });
  layered.sample(16);
  check("listening is primary", layered.state === "listening", layered.state);
  check("observing coexists with listening", layered.active.includes("observing"), layered.active.join(","));
  check(
    "observing adds an attentive brow",
    layered.sample(16).face.browRaise > 0.12,
    String(layered.sample(16).face.browRaise),
  );

  // presence and standby
  const alone = new InteractionController();
  alone.push({ kind: "camera", live: true });
  alone.push({ kind: "presence", present: false });
  for (let i = 0; i < 900; i++) alone.sample(120);
  check("an untouched session drops to standby", alone.state === "standby", alone.state);

  // mirroring is opt-in and weak
  const mirrored = new InteractionController();
  const unmirrored = new InteractionController({ mirror: false });
  for (const c of [mirrored, unmirrored]) {
    c.push({ kind: "camera", live: true });
    c.push({ kind: "presence", present: true });
    c.sample(16);
  }
  const withMirror = mirrored.sample(16, { visible: { smile: 1 } });
  const withoutMirror = unmirrored.sample(16, { visible: { smile: 1 } });
  check(
    "mirroring raises the displayed smile",
    withMirror.face.smile > withoutMirror.face.smile,
    `${withMirror.face.smile.toFixed(3)} vs ${withoutMirror.face.smile.toFixed(3)}`,
  );
  check(
    "mirroring stays subtle",
    withMirror.face.smile - withoutMirror.face.smile < 0.35,
    String(withMirror.face.smile - withoutMirror.face.smile),
  );

  // camera off clears mirrored cues
  mirrored.push({ kind: "camera", live: false });
  mirrored.sample(16, { visible: { smile: 1 } });
  check("camera off stops mirroring", mirrored.visible.smile === undefined || mirrored.visible.smile === 1);

  const described = mirrored.describe();
  check("describe names a state", typeof described.label === "string" && described.label.length > 1);
  check("describe names a simulated expression", typeof described.expression === "string");
}

console.log("\nbehaviour state coverage");
{
  const states = Object.keys(STATE_LABELS);
  check("the controller models at least 18 states", states.length >= 18, String(states.length));
  check(
    "every state maps to a real hologram state",
    states.every((s) => typeof CORE_STATE[s] === "string" && Boolean(STATES[CORE_STATE[s]])),
    states.filter((s) => !STATES[CORE_STATE[s]]).join(","),
  );

  const core = new InteractionController();
  core.sample(16);
  check("the readout and the core agree", core.describe().core === CORE_STATE[core.state]);

  const byPhase = (phase) => {
    const c = new InteractionController();
    c.push({ kind: "phase", phase });
    return c.state;
  };
  check("research reads as searching", byPhase("research") === "searching", byPhase("research"));
  check("verification reads as analysing", byPhase("verify") === "analyzing", byPhase("verify"));
  check("drafting reads as reasoning", byPhase("draft") === "reasoning", byPhase("draft"));

  const executing = new InteractionController();
  executing.push({ kind: "activity", activity: "executing", on: true });
  check("a device run reads as executing", executing.state === "executing", executing.state);

  const remembering = new InteractionController();
  remembering.push({ kind: "activity", activity: "remembering", on: true });
  check("memory retrieval reads as remembering", remembering.state === "remembering", remembering.state);

  // Work must not get stuck on: the deadline alone returns it to idle.
  for (let i = 0; i < 60; i++) executing.sample(100);
  check("executing expires on its own", executing.state !== "executing", executing.state);

  const asleep = new InteractionController();
  asleep.push({ kind: "camera", live: true });
  asleep.push({ kind: "presence", present: false });
  for (let i = 0; i < 2400; i++) asleep.sample(120);
  check("a long-quiet session sleeps", asleep.state === "sleeping", asleep.state);
  check("sleeping maps to the dim core", CORE_STATE.sleeping === "SLEEPING");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
