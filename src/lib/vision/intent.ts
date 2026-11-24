/**
 * HYDRO AI — visual-intent detection.
 *
 * Decides whether a message is asking about what the camera can see, so a frame
 * is captured and analysed only when it is actually relevant. A frame per
 * message would be slow and expensive; a missed frame means HYDRO answers a
 * visual question from local tracking alone.
 *
 * Deterministic on purpose: it is unit-tested and it never calls a model.
 */

/** Phrases that use "see" figuratively and must not trigger a capture. */
const FIGURATIVE = [
  /\bi see (your|the) point\b/i,
  /\bi see what you mean\b/i,
  /\b(you )?see,?\s+(the thing is|it'?s)\b/i,
  /\bsee (you|ya) later\b/i,
  /\bas (you can|we) see\b/i,
];

const VISUAL_INTENT: RegExp[] = [
  /\bcan you see\b/i,
  /\bdo you see\b/i,
  /\bwhat (do|can) you see\b/i,
  /\bwhat('s| is) (in front of|around|behind|near) (you|me)\b/i,
  /\bwhat am i (holding|showing|wearing)\b/i,
  /\bwhat('s| is) (this|that) (object|thing|item)\b/i,
  /\b(wear|wearing|outfit|shirt|t-?shirt|dress|jacket|hoodie)\b/i,
  /\bcolou?r\b/i,
  /\bholding|show(ing)? (you|me)?\s*(this|it|the)\b/i,
  /\bhow many fingers\b|\bfingers?\b/i,
  /\bbehind me\b|\baround me\b/i,
  /\bmy (hand|face|hair|glasses|phone|book)\b/i,
  /\bread (this|the|it)\b|\bwhat does (this|it) say\b/i,
  /\bthis (document|page|paper|book|label|note|screen)\b/i,
  /\bam i (visible|moving|in frame)\b|\bcan you look\b/i,
  /\bvisible\b/i,
  /\bcamera\b/i,
];

export function wantsVisualAnswer(text: string): boolean {
  const clean = (text ?? "").trim();
  if (clean.length < 3) return false;
  if (FIGURATIVE.some((re) => re.test(clean))) return false;
  return VISUAL_INTENT.some((re) => re.test(clean));
}
