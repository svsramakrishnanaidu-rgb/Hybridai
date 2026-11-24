"use client";

/**
 * HYDRO AI — on-device vision engine.
 *
 * Camera frames are decoded and analysed in this browser tab by MediaPipe's
 * WASM/GPU landmark models, served from /models and /mediapipe in this project.
 * No frame, landmark, embedding or video stream is uploaded by this module:
 * the only way an image ever leaves the device is an explicit `capture()` the
 * user triggers with "Ask what I see".
 *
 * The engine is deliberately separate from the hologram: it can stop, fail or
 * be denied without touching the render loop.
 */

import type { FaceLandmarker, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { GestureTracker } from "./gestures";
import { HeadGestureTracker } from "./head";
import { matchTemplate, poseSignature, type MatchableTemplate } from "./pose";
import { signatureFromRgba, type SceneSignature } from "./sight";
import { cropBox, type SelectionRect } from "./selection";
import {
  EMPTY_FACE,
  type FaceSignal,
  type GestureEvent,
  type HandFrame,
  type Landmark,
  type PoseSignal,
  type VisionSample,
  type VisionSignals,
  type VisionStatus,
} from "./types";

const WASM_PATH = "/mediapipe/wasm";
const FACE_MODEL = "/models/face_landmarker.task";
const HAND_MODEL = "/models/hand_landmarker.task";
const POSE_MODEL = "/models/pose_landmarker_lite.task";

type Models = {
  face: FaceLandmarker;
  hands: HandLandmarker;
  pose: PoseLandmarker;
};

let modelsPromise: Promise<Models> | null = null;

/** Models load once per page and are reused when the camera is toggled. */
async function loadModels(): Promise<Models> {
  if (modelsPromise) return modelsPromise;
  modelsPromise = (async () => {
    const mp = await import("@mediapipe/tasks-vision");
    const fileset = await mp.FilesetResolver.forVisionTasks(WASM_PATH);
    const [face, hands, pose] = await Promise.all([
      mp.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true,
      }),
      mp.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
      mp.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
      }),
    ]);
    return { face, hands, pose };
  })().catch((err) => {
    modelsPromise = null;
    throw err;
  });
  return modelsPromise;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mean(a: Landmark[]): { x: number; y: number } {
  if (!a.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of a) {
    x += p.x;
    y += p.y;
  }
  return { x: x / a.length, y: y / a.length };
}

function shapeValue(
  categories: Array<{ categoryName: string; score: number }> | undefined,
  name: string,
): number {
  if (!categories) return 0;
  const hit = categories.find((c) => c.categoryName === name);
  return hit ? hit.score : 0;
}

export interface VisionEngineOptions {
  onSample: (sample: VisionSample) => void;
  onGesture: (event: GestureEvent) => void;
  onStatus: (status: VisionStatus, detail?: string) => void;
  /** detection rate target; actual throughput is reported in the sample */
  targetFps?: number;
  /** set true while an observation is being captured, to drive scan effects */
  signals: VisionSignals;
  /** user setting: how strongly the hologram follows the detected person */
  gazeGain?: () => number;
  /** user-taught pose templates, read per frame from a cached list */
  customTemplates?: () => MatchableTemplate[];
}

export class VisionEngine {
  private video: HTMLVideoElement;
  private opts: VisionEngineOptions;
  private stream: MediaStream | null = null;
  private models: Models | null = null;
  private tracker = new GestureTracker();
  private head = new HeadGestureTracker();
  private raf = 0;
  private running = false;
  private lastVideoTime = -1;
  private lastRunAt = 0;
  private lastSampleAt = 0;
  private frameIntervals: number[] = [];
  private detectIntervals: number[] = [];
  private lastDetectAt = 0;
  private poseEvery = 4;
  private poseFrame = 0;
  private facing: "user" | "environment" = "user";
  private disposed = false;
  private lastCustomAt = 0;
  private customSeq = 0;
  private signature: number[] | null = null;
  /** slow per-session shoulder baseline, so "settling" is relative to this user */
  private shoulderBaseline: number | null = null;

  constructor(video: HTMLVideoElement, opts: VisionEngineOptions) {
    this.video = video;
    this.opts = opts;
  }

  get isLive(): boolean {
    return this.running;
  }

  get facingMode(): "user" | "environment" {
    return this.facing;
  }

  async start(facing: "user" | "environment" = this.facing): Promise<void> {
    if (this.running) return;
    this.facing = facing;
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      this.opts.onStatus("unsupported", "This browser exposes no camera API.");
      throw new Error("Camera API unavailable");
    }

    this.opts.onStatus("requesting", "Waiting for camera permission");
    // A permission prompt can sit unanswered indefinitely. Never leave the UI
    // stuck in "starting" — and never start a stream the user has moved on from.
    let abandoned = false;
    const promptTimer = setTimeout(() => {
      if (this.stream) return;
      abandoned = true;
      this.opts.onStatus("idle", "No answer to the camera prompt. Nothing was opened.");
    }, 25_000);
    try {
      this.stream = await media.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (err) {
      clearTimeout(promptTimer);
      const name = err instanceof Error ? err.name : "";
      const denied = name === "NotAllowedError" || name === "SecurityError";
      this.opts.onStatus(
        denied ? "denied" : "error",
        denied
          ? "Camera permission was denied. HYDRO works without it."
          : err instanceof Error
            ? err.message
            : "Camera could not start.",
      );
      throw err;
    }
    clearTimeout(promptTimer);
    if (abandoned) {
      this.stopTracks();
      return;
    }

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;

    this.opts.onStatus("loading", "Loading on-device landmark models");
    try {
      this.models = await loadModels();
    } catch (err) {
      this.stopTracks();
      this.opts.onStatus(
        "error",
        err instanceof Error
          ? `Landmark models failed to load: ${err.message}. Camera is off.`
          : "Landmark models failed to load. Camera is off.",
      );
      throw err;
    }
    if (this.disposed) {
      this.stopTracks();
      return;
    }

    try {
      await this.video.play();
    } catch {
      // autoplay of a muted stream can still be blocked; the frame check below
      // simply never fires, and the UI reports no detections rather than lying
    }

    this.running = true;
    this.tracker.reset();
    this.lastVideoTime = -1;
    this.shoulderBaseline = null;
    this.head.reset();
    this.opts.onStatus("live", "Tracking on this device");
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stopTracks();
    this.tracker.reset();
    this.opts.signals.presence = 0;
    this.opts.signals.attention = 0;
    this.opts.signals.gazeX = 0;
    this.opts.signals.gazeY = 0;
    this.opts.signals.mirrorSmile = 0;
    this.opts.signals.mirrorBrow = 0;
    this.opts.signals.mirrorSquint = 0;
    this.opts.onSample({
      at: Date.now(),
      face: EMPTY_FACE,
      faces: 0,
      hands: { count: 0, gesture: null, confidence: 0 },
      pose: { present: false, shoulderX: null, shoulderY: null, lean: 0, settle: 0 },
      fps: 0,
      inferenceMs: 0,
      quality: this.models ? "landmarks" : "unavailable",
    });
    this.opts.onStatus("idle");
  }

  private stopTracks(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video.srcObject) this.video.srcObject = null;
  }

  /** Flip between the front and rear camera (phones, external cameras). */
  async switchCamera(): Promise<void> {
    const next = this.facing === "user" ? "environment" : "user";
    this.stop();
    await this.start(next);
  }

  /** Latest normalised hand pose, used when the user captures a custom gesture. */
  currentSignature(): number[] | null {
    return this.signature;
  }

  /** Grab one frame as JPEG for an authorised, explicit visual question. */
  capture(maxWidth = 900): { dataUrl: string; mime: string } | null {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight) return null;
    const scale = Math.min(1, maxWidth / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.72), mime: "image/jpeg" };
  }

  /**
   * Grab one frame already cropped to a selected region. The rectangle is
   * normalised to the frame, so it survives a resized preview, and only those
   * pixels are encoded — the rest of the scene never leaves the tab.
   */
  captureRegion(
    rect: SelectionRect,
    maxWidth = 900,
  ): { dataUrl: string; mime: string } | null {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight) return null;
    const box = cropBox(rect, v.videoWidth, v.videoHeight, maxWidth);
    if (!box) return null;
    const canvas = document.createElement("canvas");
    canvas.width = box.width;
    canvas.height = box.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, box.sx, box.sy, box.sw, box.sh, 0, 0, box.width, box.height);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.8), mime: "image/jpeg" };
  }

  /**
   * Cheap luminance fingerprint for continuous sight. Draws only 16×9 pixels,
   * so the per-tick cost is one tiny drawImage — never a JPEG encode.
   */
  sceneSignature(): SceneSignature | null {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight) return null;
    const small = document.createElement("canvas");
    small.width = 16;
    small.height = 9;
    const ctx = small.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, 16, 9);
    return signatureFromRgba(ctx.getImageData(0, 0, 16, 9).data);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.models?.face.close();
    this.models?.hands.close();
    this.models?.pose.close();
    this.models = null;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    const now = performance.now();
    const interval = 1000 / Math.max(4, this.opts.targetFps ?? 20);
    if (now - this.lastRunAt < interval) return;
    const v = this.video;
    if (!v.videoWidth || v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    this.lastRunAt = now;

    const started = performance.now();
    try {
      this.detect(v, now);
    } catch {
      // a dropped frame is not a fatal error; the next one retries
    }
    const took = performance.now() - started;
    this.frameIntervals.push(took);
    if (this.frameIntervals.length > 24) this.frameIntervals.shift();
    if (this.lastDetectAt) {
      this.detectIntervals.push(now - this.lastDetectAt);
      if (this.detectIntervals.length > 16) this.detectIntervals.shift();
    }
    this.lastDetectAt = now;
  };

  private detect(video: HTMLVideoElement, now: number): void {
    const models = this.models;
    if (!models) return;
    const ts = now;

    const faceResult = models.face.detectForVideo(video, ts);
    const handResult = models.hands.detectForVideo(video, ts);
    this.poseFrame = (this.poseFrame + 1) % this.poseEvery;
    const poseResult =
      this.poseFrame === 0 ? models.pose.detectForVideo(video, ts) : null;

    const face = this.readFace(faceResult);
    const faceCount = faceResult.faceLandmarks?.length ?? 0;
    const hands = (handResult.landmarks ?? []).map((landmarks, i) => {
      const category = handResult.handedness?.[i]?.[0];
      return {
        landmarks: landmarks as Landmark[],
        handedness:
          category?.categoryName === "Left"
            ? "Left"
            : category?.categoryName === "Right"
              ? "Right"
              : "Unknown",
        score: category?.score ?? 0.5,
      } satisfies HandFrame;
    });

    // A nod or shake is only a command when the head really reverses twice;
    // the tracker returns null for ordinary looking around.
    const headGesture = this.head.push({
      yaw: face.yaw,
      pitch: face.pitch,
      present: face.present,
      at: Date.now(),
    });
    if (headGesture) {
      this.opts.onGesture({
        id: ++this.customSeq,
        name: headGesture,
        confidence: 0.8,
        at: Date.now(),
      });
    }

    const events = this.tracker.push(hands, now);
    for (const event of events) this.opts.onGesture(event);

    // user-taught poses: matched against stored templates, debounced, and only
    // when the built-in classifier has not already fired this frame
    this.signature = hands.length ? poseSignature(hands[0].landmarks) : null;
    const templates = this.opts.customTemplates?.() ?? [];
    if (this.signature && templates.length && events.length === 0 && now - this.lastCustomAt > 1800) {
      const match = matchTemplate(this.signature, templates, 0.22);
      if (match) {
        this.lastCustomAt = now;
        this.opts.onGesture({
          id: ++this.customSeq,
          name: "custom",
          confidence: Math.max(0, 1 - match.distance / 0.22),
          at: Date.now(),
          custom: {
            id: match.template.id,
            name: match.template.name,
            command: match.template.command,
          },
        });
      }
    }

    let pose: PoseSignal = { present: false, shoulderX: null, shoulderY: null, lean: 0, settle: 0 };
    const poseLandmarks = poseResult?.landmarks?.[0];
    if (poseLandmarks && poseLandmarks.length > 12) {
      const ls = poseLandmarks[11];
      const rs = poseLandmarks[12];
      if (ls && rs) {
        const midY = (ls.y + rs.y) / 2;
        const width = Math.max(0.05, Math.abs(rs.x - ls.x));
        // Tilt is real geometry. Interpreting it as "slouching" would not be,
        // so the panel labels it as an approximate posture change.
        const lean = clamp((ls.y - rs.y) / width, -1, 1);
        this.shoulderBaseline =
          this.shoulderBaseline === null
            ? midY
            : this.shoulderBaseline + (midY - this.shoulderBaseline) * 0.02;
        const settle = clamp((midY - this.shoulderBaseline) / 0.06, 0, 1);
        pose = {
          present: true,
          shoulderX: (ls.x + rs.x) / 2,
          shoulderY: midY,
          lean,
          settle,
        };
      }
    }

    // hologram signals are written every frame; React state is throttled
    const sig = this.opts.signals;
    const targetPresence = face.present ? 1 : 0;
    sig.presence += (targetPresence - sig.presence) * 0.15;
    sig.attention += ((face.present ? 1 : 0) - sig.attention) * 0.1;
    const gain = clamp(this.opts.gazeGain?.() ?? 1, 0.2, 2);
    sig.gazeX += (clamp(face.gazeX * gain, -1, 1) - sig.gazeX) * 0.2;
    sig.gazeY += (clamp(face.gazeY * gain, -1, 1) - sig.gazeY) * 0.2;
    sig.blink += (face.blink - sig.blink) * 0.45;
    sig.mouth += (face.mouth - sig.mouth) * 0.4;
    sig.mirrorSmile += (face.smile - sig.mirrorSmile) * 0.25;
    sig.mirrorBrow += (face.brow - sig.mirrorBrow) * 0.25;
    sig.mirrorSquint += (face.squint - sig.mirrorSquint) * 0.25;

    const avg = this.frameIntervals.length
      ? this.frameIntervals.reduce((a, b) => a + b, 0) / this.frameIntervals.length
      : 0;
    const intervalAvg = this.detectIntervals.length
      ? this.detectIntervals.reduce((a, b) => a + b, 0) / this.detectIntervals.length
      : 0;
    if (now - this.lastSampleAt > 140) {
      this.lastSampleAt = now;
      const reading = hands.length
        ? this.tracker.lastGestures
        : { gesture: null, confidence: 0 };
      this.opts.onSample({
        at: Date.now(),
        face,
        faces: faceCount,
        hands: { count: hands.length, gesture: reading.gesture, confidence: reading.confidence },
        pose,
        fps: intervalAvg > 0 ? Math.round(1000 / intervalAvg) : 0,
        inferenceMs: Math.round(avg * 10) / 10,
        quality: "landmarks",
      });
    }
  }

  private readFace(result: ReturnType<FaceLandmarker["detectForVideo"]>): FaceSignal {
    const lm = result.faceLandmarks?.[0];
    if (!lm || lm.length < 300) return EMPTY_FACE;

    const leftEye = lm[33];
    const rightEye = lm[263];
    const nose = lm[1];
    const eyeMid = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
    const eyeDist = Math.max(1e-4, Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y));

    // The preview is mirrored, so screen-space attention is 1 − image-space x.
    const screenX = 1 - eyeMid.x;
    const screenY = 1 - eyeMid.y;

    // iris offset within the eye opening, when the 478-point model provides it
    let irisOffset = 0;
    if (lm.length >= 478) {
      const irisL = mean(lm.slice(468, 472));
      const irisR = mean(lm.slice(473, 477));
      const iris = { x: (irisL.x + irisR.x) / 2, y: (irisL.y + irisR.y) / 2 };
      irisOffset = clamp((iris.x - eyeMid.x) / eyeDist, -0.5, 0.5);
    }

    const yawImage = clamp(((nose.x - eyeMid.x) / eyeDist) * 2, -1, 1);
    const pitchImage = clamp(((nose.y - eyeMid.y) / Math.max(eyeDist, 0.02) - 0.55) * 1.6, -1, 1);

    const categories = result.faceBlendshapes?.[0]?.categories as
      | Array<{ categoryName: string; score: number }>
      | undefined;
    const blink = clamp(
      (shapeValue(categories, "eyeBlinkLeft") + shapeValue(categories, "eyeBlinkRight")) / 2,
      0,
      1,
    );
    const mouth = clamp(shapeValue(categories, "jawOpen"), 0, 1);
    const smile = clamp(
      (shapeValue(categories, "mouthSmileLeft") + shapeValue(categories, "mouthSmileRight")) / 2,
      0,
      1,
    );
    const brow = clamp(shapeValue(categories, "browInnerUp"), 0, 1);
    const squint = clamp(
      (shapeValue(categories, "eyeSquintLeft") + shapeValue(categories, "eyeSquintRight")) / 2,
      0,
      1,
    );
    const browDown = clamp(
      (shapeValue(categories, "browDownLeft") + shapeValue(categories, "browDownRight")) / 2,
      0,
      1,
    );
    const frown = clamp(
      (shapeValue(categories, "mouthFrownLeft") + shapeValue(categories, "mouthFrownRight")) / 2,
      0,
      1,
    );

    return {
      present: true,
      gazeX: clamp((screenX - 0.5) * 2.4 + irisOffset * 1.4, -1, 1),
      gazeY: clamp(-(screenY - 0.5) * 2.4 + pitchImage * 0.35, -1, 1),
      yaw: -yawImage,
      pitch: -pitchImage,
      blink,
      mouth,
      smile,
      brow,
      squint,
      browDown,
      frown,
    };
  }
}
