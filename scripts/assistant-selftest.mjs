/**
 * HYDRO AI — selection geometry and local command intents.
 *
 * Run: npm run assistant:test
 *
 * These are the pure modules behind "point at this and ask", "save this" and
 * "remember this". No browser, camera, microphone or model call is involved.
 */

import assert from "node:assert/strict";
import {
  MIN_SELECTION,
  cropBox,
  isUsableRect,
  normalizeSelection,
  selectionContext,
  selectionLabel,
  tapSelection,
} from "../src/lib/vision/selection.ts";
import {
  isReplyLanguage,
  languageDirective,
  noteTitle,
  parseForgetRequest,
  parseRememberRequest,
  parseSaveRequest,
} from "../src/lib/assistant/intents.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\nselection geometry");

test("a drag produces a normalised rectangle regardless of direction", () => {
  const down = normalizeSelection({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.8 });
  const up = normalizeSelection({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 });
  assert.deepEqual(down, { x: 0.2, y: 0.3, w: 0.4, h: 0.5 });
  assert.deepEqual(up, down);
});

test("a slip below the minimum size is not a selection", () => {
  assert.equal(normalizeSelection({ x: 0.2, y: 0.2 }, { x: 0.2 + MIN_SELECTION / 2, y: 0.5 }), null);
  assert.equal(normalizeSelection({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), null);
});

test("non-finite input is rejected instead of becoming NaN geometry", () => {
  assert.equal(normalizeSelection({ x: NaN, y: 0 }, { x: 0.5, y: 0.5 }), null);
  assert.equal(normalizeSelection({ x: 0, y: 0 }, { x: Infinity, y: 0.5 }), null);
});

test("a drag outside the frame is clamped into it", () => {
  const rect = normalizeSelection({ x: -0.4, y: -0.2 }, { x: 1.4, y: 1.6 });
  assert.deepEqual(rect, { x: 0, y: 0, w: 1, h: 1 });
  assert.ok(isUsableRect(rect));
});

test("a tap frames a box around the point and stays inside at edges", () => {
  const middle = tapSelection(0.5, 0.5);
  assert.equal(middle.w, 0.32);
  assert.equal(middle.x, 0.34);
  const corner = tapSelection(0.01, 0.99);
  assert.equal(corner.x, 0);
  assert.equal(corner.y + corner.h, 1);
  assert.ok(isUsableRect(corner));
  assert.ok(isUsableRect(tapSelection(2, -3)));
});

test("selection labels describe where the region is", () => {
  assert.equal(selectionLabel({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }), "centre");
  assert.equal(selectionLabel({ x: 0.02, y: 0.02, w: 0.2, h: 0.2 }), "upper left");
  assert.equal(selectionLabel({ x: 0.7, y: 0.75, w: 0.2, h: 0.2 }), "lower right");
  assert.equal(selectionLabel({ x: 0.25, y: 0.7, w: 0.5, h: 0.25 }), "lower centre");
});

test("cropBox maps normalised coordinates to source pixels", () => {
  const box = cropBox({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1920, 1080, 900);
  assert.equal(box.sx, 480);
  assert.equal(box.sy, 540);
  assert.equal(box.sw, 960);
  assert.equal(box.height, Math.round(270 * (900 / 960)));
  assert.ok(box.width <= 900);
});

test("a small region is not upscaled past the frame's own resolution", () => {
  const box = cropBox({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, 640, 480, 900);
  assert.equal(box.width, 64);
  assert.equal(box.height, 48);
});

test("cropBox refuses an unusable rectangle or a dead video element", () => {
  assert.equal(cropBox({ x: 0, y: 0, w: 0.001, h: 0.5 }, 640, 480), null);
  assert.equal(cropBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0, 0), null);
  assert.equal(cropBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, NaN, 480), null);
});

test("selection context names the area and binds deictic words to it", () => {
  const text = selectionContext({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 });
  assert.match(text, /SELECTED REGION/);
  assert.match(text, /centre/);
  assert.match(text, /x 25%–75%, y 50%–75%/);
  assert.match(text, /idi/);
  assert.match(text, /too tight/);
});

console.log("\nsave intent");

test("save this is recognised", () => {
  assert.deepEqual(parseSaveRequest("save this"), { title: null });
});

test("a Telugu-English save request is recognised", () => {
  assert.ok(parseSaveRequest("ee explanation naa project notes lo save chey"));
  assert.ok(parseSaveRequest("dini save chey"));
  assert.ok(parseSaveRequest("idi notes lo pettu"));
});

test("an explicit title is captured", () => {
  assert.deepEqual(parseSaveRequest("save this as DHRUVA palette"), { title: "DHRUVA palette" });
});

test("unrelated uses of save are not file operations", () => {
  assert.equal(parseSaveRequest("save the world"), null);
  assert.equal(parseSaveRequest("how do I save a file?"), null);
  assert.equal(parseSaveRequest("save this for later"), null);
  assert.equal(parseSaveRequest("what is a save point in a game"), null);
});

console.log("\nmemory intents");

test("remember extracts the fact without the cue", () => {
  assert.equal(
    parseRememberRequest("remember that the DHRUVA palette is #00E5FF and #05070A"),
    "the DHRUVA palette is #00E5FF and #05070A",
  );
  assert.equal(parseRememberRequest("gurtu pettuko project name DHRUVA"), "project name DHRUVA");
});

test("a question about memory is not a memory write", () => {
  assert.equal(parseRememberRequest("what do you remember about my project?"), null);
  assert.equal(parseRememberRequest("remember"), null);
});

test("forget returns the query, and bare forget it does not", () => {
  assert.deepEqual(parseForgetRequest("forget the palette"), { query: "the palette" });
  assert.deepEqual(parseForgetRequest("forget this"), { query: "this" });
  assert.equal(parseForgetRequest("forget it"), null);
  assert.equal(parseForgetRequest("I will never forget that day"), null);
  assert.deepEqual(parseForgetRequest("forget that memory"), { query: "" });
  assert.deepEqual(parseForgetRequest("Please forget my address."), { query: "my address" });
});

test("note titles are readable and bounded", () => {
  assert.equal(noteTitle("", "fallback"), "fallback");
  assert.ok(noteTitle("one two three four five six seven eight nine ten", "x").split(" ").length <= 8);
});

console.log("\nreply language");

test("only supported languages are accepted", () => {
  assert.ok(isReplyLanguage("te"));
  assert.ok(isReplyLanguage("mixed"));
  assert.ok(!isReplyLanguage("fr"));
  assert.ok(!isReplyLanguage(null));
});

test("an explicit Telugu choice produces a directive that protects identifiers", () => {
  const text = languageDirective("te");
  assert.match(text, /Telugu/);
  assert.match(text, /file names/);
  assert.equal(languageDirective("auto"), "");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
