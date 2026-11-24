/**
 * HYDRO AI — camera context contract (pure).
 *
 * One shared description of what the camera can currently provide, validated
 * once at the API boundary and reused by the orchestrator. Everything here is
 * either measured by the browser's local tracker or produced by a vision model
 * from one frame; nothing is inferred about identity, emotion or intent.
 *
 * No DOM, no network: the self-test imports this module directly.
 */

export type FrameMime = "image/jpeg" | "image/png" | "image/webp";

export interface FrameInput {
  mimeType: FrameMime;
  /** base64, no data-url prefix */
  data: string;
}

/** ~1.6 MB of base64 is roughly a 1.2 MB image. */
export const MAX_FRAME_CHARS = 2_200_000;

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/**
 * Validate a data URL from the browser. A malformed or oversized frame is
 * rejected outright rather than silently dropped later in the pipeline.
 */
export function parseFrame(raw: unknown): FrameInput | null {
  if (typeof raw !== "string") return null;
  const match = DATA_URL.exec(raw);
  if (!match) return null;
  if (match[2].length > MAX_FRAME_CHARS) return null;
  return { mimeType: match[1] as FrameMime, data: match[2] };
}

export type LightLevel = "good" | "dim" | "bright" | "flat";

/**
 * Browser-measured camera state. These are facts the server cannot see: the
 * camera's activation, whether a person is in frame, hand count, gaze and the
 * measured light level of the last sampled frame.
 */
export interface CameraState {
  active: boolean;
  presence?: boolean;
  faces?: number;
  hands?: number;
  gesture?: string;
  gazeX?: number;
  gazeY?: number;
  light?: LightLevel;
  /** age of the frame the client sent, in ms */
  frameAgeMs?: number;
}

const LIGHT: LightLevel[] = ["good", "dim", "bright", "flat"];

function num(value: unknown, lo: number, hi: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(lo, Math.min(hi, value))
    : undefined;
}

export function normalizeCameraState(raw: unknown): CameraState | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  if (typeof box.active !== "boolean") return null;

  const state: CameraState = { active: box.active };
  if (typeof box.presence === "boolean") state.presence = box.presence;

  const faces = num(box.faces, 0, 8);
  if (faces !== undefined) state.faces = Math.round(faces);

  const hands = num(box.hands, 0, 4);
  if (hands !== undefined) state.hands = Math.round(hands);

  if (typeof box.gesture === "string" && /^[a-z_]{2,24}$/.test(box.gesture)) {
    state.gesture = box.gesture;
  }

  const gazeX = num(box.gazeX, -1, 1);
  if (gazeX !== undefined) state.gazeX = gazeX;
  const gazeY = num(box.gazeY, -1, 1);
  if (gazeY !== undefined) state.gazeY = gazeY;

  if (typeof box.light === "string" && LIGHT.includes(box.light as LightLevel)) {
    state.light = box.light as LightLevel;
  }

  const age = num(box.frameAgeMs, 0, 120_000);
  if (age !== undefined) state.frameAgeMs = Math.round(age);

  return state;
}

/** Human-readable, bounded rendering of the measured camera state. */
export function cameraBlock(camera: CameraState | null): string {
  if (!camera) return "";
  if (!camera.active) return "- Camera: off (no camera session is running)";

  const bits: string[] = ["- Camera: live in the user's browser, permission granted"];
  if (typeof camera.presence === "boolean") {
    bits.push(
      camera.presence
        ? `- Local face tracking: a person is in frame${camera.faces && camera.faces > 1 ? ` (${camera.faces} faces detected)` : ""}`
        : "- Local face tracking: no face currently in frame",
    );
  }
  if (typeof camera.hands === "number") {
    bits.push(
      camera.hands > 0
        ? `- Local hand tracking: ${camera.hands} hand(s) visible${camera.gesture ? `, current gesture ${camera.gesture}` : ""}`
        : "- Local hand tracking: no hands visible",
    );
  }
  if (typeof camera.gazeX === "number" && typeof camera.gazeY === "number") {
    const horizontal = camera.gazeX < -0.2 ? "left of centre" : camera.gazeX > 0.2 ? "right of centre" : "centred";
    bits.push(`- Gaze target: ${horizontal} (${camera.gazeX.toFixed(2)}, ${camera.gazeY.toFixed(2)})`);
  }
  if (camera.light) bits.push(`- Measured light in the last sampled frame: ${camera.light}`);
  if (typeof camera.frameAgeMs === "number") {
    bits.push(`- Attached frame age: ${(camera.frameAgeMs / 1000).toFixed(1)} s`);
  }
  return bits.join("\n");
}

export interface DirectiveInput {
  camera: CameraState | null;
  /** observation produced by the vision model from this turn's frame */
  observation: string | null;
  model: string | null;
  /** why the frame could not be analysed, when it could not */
  error?: string | null;
}

/**
 * The capability statement given to the intelligence core.
 *
 * This is the fix for the model answering "I have no access to a camera": the
 * core is told, per turn, what it actually has. It is equally explicit when it
 * has nothing, so the opposite failure — claiming to see without data — cannot
 * happen either.
 */
export function visionDirective(input: DirectiveInput): string {
  const { camera, observation, model, error } = input;
  const lines: string[] = ["CAMERA CAPABILITY — measured for this turn"];

  if (!camera || !camera.active) {
    lines.push(
      "- The camera is OFF. You have no visual input in this turn.",
      "- If the user asks whether you can see them or anything else, say plainly that live vision is off, and that they can turn the camera on if they want you to look.",
      "- Never describe a person, scene, object, colour or text as if you could see it, and never say you have a camera feed.",
    );
    return lines.join("\n");
  }

  lines.push("- The user's camera is LIVE and they granted permission for this session.");

  if (observation) {
    lines.push(
      `- One frame was captured and analysed by ${model ?? "a vision-capable model"}; its observation is in the CAMERA OBSERVATION block.`,
      "- You therefore DO have visual input for this turn. Never say that you have no camera, no image access, or that you are text-only.",
      "- Answer about what is visible only from that observation plus the local measurements below. You cannot see anything outside that frame or at a different moment.",
      "- If the observation does not cover what was asked, or the image was unclear, say what is unclear and ask the user to hold it steadier or move closer instead of guessing.",
      "- Never identify the person, and never estimate age, emotion, health, ethnicity or intent from appearance.",
    );
  } else if (error) {
    lines.push(
      `- A frame was captured but could not be analysed (${error}).`,
      "- Do not describe the scene. Say that the look failed and that you can retry or answer in text, and report the failure plainly without inventing what the frame showed.",
    );
  } else {
    lines.push(
      "- No frame was analysed for this turn (the user did not ask about what is visible).",
      "- You may report what local tracking measures, but do not describe appearance, clothing, colours, objects or text. If asked, offer to take a look at the current frame.",
    );
  }

  const block = cameraBlock(camera);
  if (block) lines.push(block);
  return lines.join("\n");
}
