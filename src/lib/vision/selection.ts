/**
 * HYDRO AI — selected camera region.
 *
 * Pure geometry only: no DOM, no canvas, no React. The vision dock maps a tap
 * or a drag on the preview to a normalised rectangle (0…1 of the frame), the
 * engine crops exactly that rectangle out of the video, and the question sent
 * to the model carries a description of the area so "this" and "the second
 * step" resolve to what the user actually framed.
 *
 * A selection is normalised to the frame, so it stays meaningful when the
 * preview is resized, and it is dropped when the camera stops.
 */

export interface SelectionRect {
  /** left edge, 0…1 of the frame width */
  x: number;
  /** top edge, 0…1 of the frame height */
  y: number;
  /** width, 0…1 */
  w: number;
  /** height, 0…1 */
  h: number;
}

/** Anything smaller than this is a stray click, not a region. */
export const MIN_SELECTION = 0.03;

/** Default box for a plain tap, as a share of the frame. */
export const TAP_BOX = 0.32;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** True when a value is a plausible region of a frame. */
export function isUsableRect(value: unknown): value is SelectionRect {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<SelectionRect>;
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.w) &&
    Number.isFinite(r.h) &&
    (r.w as number) >= MIN_SELECTION &&
    (r.h as number) >= MIN_SELECTION &&
    (r.x as number) >= 0 &&
    (r.y as number) >= 0 &&
    (r.x as number) + (r.w as number) <= 1.0001 &&
    (r.y as number) + (r.h as number) <= 1.0001
  );
}

/**
 * Rectangle between two corner points, clamped to the frame.
 * Returns null for a box below the minimum size, so a drag that slipped is not
 * sent to a model as a region.
 */
export function normalizeSelection(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SelectionRect | null {
  if (![start.x, start.y, end.x, end.y].every((n) => Number.isFinite(n))) return null;
  const x1 = clamp01(start.x);
  const y1 = clamp01(start.y);
  const x2 = clamp01(end.x);
  const y2 = clamp01(end.y);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w < MIN_SELECTION || h < MIN_SELECTION) return null;
  return {
    x: round(Math.min(x1, x2)),
    y: round(Math.min(y1, y2)),
    w: round(w),
    h: round(h),
  };
}

/** A tap becomes a box around the tapped point, kept inside the frame. */
export function tapSelection(x: number, y: number, size = TAP_BOX): SelectionRect {
  const w = Math.min(1, Math.max(MIN_SELECTION, size));
  const h = Math.min(1, Math.max(MIN_SELECTION, size));
  const left = Math.min(Math.max(0, clamp01(x) - w / 2), 1 - w);
  const top = Math.min(Math.max(0, clamp01(y) - h / 2), 1 - h);
  return { x: round(left), y: round(top), w: round(w), h: round(h) };
}

/** Where the region is, in words a person would use. */
export function selectionLabel(rect: SelectionRect): string {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const horizontal = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "centre";
  const vertical = cy < 1 / 3 ? "upper" : cy > 2 / 3 ? "lower" : "middle";
  if (horizontal === "centre" && vertical === "middle") return "centre";
  if (horizontal === "centre") return `${vertical} centre`;
  return `${vertical} ${horizontal}`;
}

/**
 * Source and output pixels for a crop, preserving aspect ratio.
 * A tiny region is cropped at native resolution up to `maxWidth`, so a small
 * diagram is not upscaled into mush and a full frame is not sent at 4K.
 */
export function cropBox(
  rect: SelectionRect,
  videoW: number,
  videoH: number,
  maxWidth = 900,
): { sx: number; sy: number; sw: number; sh: number; width: number; height: number } | null {
  if (!Number.isFinite(videoW) || !Number.isFinite(videoH) || videoW < 2 || videoH < 2) return null;
  if (!isUsableRect(rect)) return null;
  const sx = Math.min(videoW - 1, Math.max(0, Math.floor(rect.x * videoW)));
  const sy = Math.min(videoH - 1, Math.max(0, Math.floor(rect.y * videoH)));
  const sw = Math.max(1, Math.min(videoW - sx, Math.round(rect.w * videoW)));
  const sh = Math.max(1, Math.min(videoH - sy, Math.round(rect.h * videoH)));
  const scale = Math.min(1, Math.max(0.05, maxWidth / sw));
  return {
    sx,
    sy,
    sw,
    sh,
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}

/**
 * The sentence attached to a question about a selection. It names the area in
 * words and in numbers, and tells the model to treat deictic words as that
 * region — without ever claiming to know what is in it before looking.
 */
export function selectionContext(rect: SelectionRect): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    `SELECTED REGION — the user framed this area of the camera image: ${selectionLabel(rect)}.`,
    `x ${pct(rect.x)}–${pct(rect.x + rect.w)}, y ${pct(rect.y)}–${pct(rect.y + rect.h)} (${pct(rect.w)} wide, ${pct(rect.h)} tall).`,
    'The image attached to this turn is that cropped region. Treat "this", "idi", "dini", "ee diagram" and "the second step" as the content of that region.',
    "If the crop is too tight to answer, say exactly what is missing instead of guessing.",
  ].join("\n");
}
