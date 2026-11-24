/**
 * HYDRO AI — frame → vision model bridge.
 *
 * One implementation of "look at this one frame and tell me what is in it",
 * shared by the explicit "Ask what I see" endpoint and by the chat pipeline
 * when a message carries a camera frame. The image is sent as inline data to a
 * vision-capable model; it is never stored.
 *
 * Failover is explicit: if a candidate model is missing or not vision-capable
 * the next one is tried, and if none answers the caller gets a real error so the
 * intelligence core can say the look failed instead of inventing a description.
 */

import { parseFrame, type FrameInput } from "./vision-context.ts";

export { parseFrame };
export type { FrameInput };

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const VISION_CANDIDATES = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
] as const;

/**
 * Rules the vision model must follow. Kept here so both callers inherit them.
 */
export const FRAME_INSTRUCTION = `You are HYDRO, looking at one still frame the user explicitly shared from their own camera.
Answer the question using only what is visibly present in this frame.
Rules:
- Separate what you can see from what you infer. If something is unclear, say "I can't tell from this frame" instead of guessing.
- Never identify a person, never estimate age, emotion, health, ethnicity or intent from appearance, and never describe biometrics.
- Do not claim to see anything outside the frame, and do not describe the camera hardware.
- If the user asked about text or a document, transcribe only what is legible and say when it is not.
- Describe clothing, colours, held objects and visible gestures plainly when they are asked about and actually visible.
- Be brief: a short paragraph, or a few bullets when listing.`;

export function visionProviderStatus(): { available: boolean; reason: string | null } {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key
    ? { available: true, reason: null }
    : {
        available: false,
        reason: "No vision provider is configured. Set GEMINI_API_KEY to let HYDRO look at camera frames.",
      };
}

export interface FrameDescription {
  text: string;
  model: string;
  latencyMs: number;
  /** provider-side reasons collected while failing over; server logs only */
  failures: string[];
}

export async function describeFrame(
  frame: FrameInput,
  question: string,
  opts: { timeoutMs?: number } = {},
): Promise<FrameDescription> {
  const status = visionProviderStatus();
  if (!status.available) throw new Error(status.reason ?? "Vision is unavailable");

  const key = process.env.GEMINI_API_KEY?.trim() as string;
  const asked = question.trim().slice(0, 1200) || "What can you see in this frame?";
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: `${FRAME_INSTRUCTION}\n\nQuestion: ${asked}` },
          { inlineData: { mimeType: frame.mimeType, data: frame.data } },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 700, temperature: 0.2 },
  };

  const started = Date.now();
  const failures: string[] = [];

  for (const model of VISION_CANDIDATES) {
    try {
      const res = await fetch(`${BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        const message = data.error?.message ?? `HTTP ${res.status}`;
        failures.push(`${model}: ${message.slice(0, 120)}`);
        // unavailable or not vision capable — try the next candidate
        if (res.status === 404 || res.status === 400) continue;
        break;
      }
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (!text) {
        failures.push(`${model}: empty response`);
        continue;
      }
      return { text, model, latencyMs: Date.now() - started, failures };
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message.slice(0, 100) : "unreachable"}`);
    }
  }

  const error = new Error(
    "The vision model could not answer that frame. Nothing was stored — try again, or ask in text.",
  );
  (error as Error & { failures?: string[] }).failures = failures;
  throw error;
}
