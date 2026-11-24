/**
 * HYDRO AI — hand pose signatures for user-taught gestures.
 *
 * A signature is the 21-point hand skeleton translated to the wrist and scaled
 * by palm size, so it is independent of where the hand is in frame or how close
 * it is to the camera. Matching is an RMS distance with a threshold; a pose that
 * is not close enough simply does not match.
 *
 * Pure module — no DOM, no MediaPipe import — so the matching can be tested.
 */

export interface Landmarkish {
  x: number;
  y: number;
}

export interface MatchableTemplate {
  id: string;
  name: string;
  command: string;
  signature: number[];
}

export function poseSignature(landmarks: Landmarkish[]): number[] | null {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
  const wrist = landmarks[0];
  const mcp = landmarks[9];
  const scale = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
  if (!Number.isFinite(scale) || scale < 1e-4) return null;

  const out: number[] = [];
  for (let i = 0; i < 21; i++) {
    const p = landmarks[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    out.push(clamp((p.x - wrist.x) / scale), clamp((p.y - wrist.y) / scale));
  }
  return out.map((n) => Math.round(n * 1000) / 1000);
}

function clamp(n: number): number {
  return Math.max(-10, Math.min(10, n));
}

/** Root-mean-square distance between two 42-value signatures. */
export function signatureDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / a.length);
}

/**
 * Best matching template under the threshold, or null. The threshold is in
 * normalised palm units: 0.22 tolerates natural hand variation without matching
 * a different pose.
 */
export function matchTemplate<T extends MatchableTemplate>(
  signature: number[] | null,
  templates: T[],
  threshold = 0.22,
): { template: T; distance: number } | null {
  if (!signature || !templates.length) return null;
  let best: { template: T; distance: number } | null = null;
  for (const template of templates) {
    const distance = signatureDistance(signature, template.signature);
    if (!Number.isFinite(distance)) continue;
    if (!best || distance < best.distance) best = { template, distance };
  }
  return best && best.distance <= threshold ? best : null;
}
