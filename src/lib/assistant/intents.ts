/**
 * HYDRO AI — local command intents.
 *
 * Small, deterministic recognisers for the handful of commands that must never
 * depend on a model call: saving the last answer, remembering a fact, and
 * forgetting one. Telugu, Romanized Telugu and English forms are matched here
 * because a misheard "save this" that reaches a language model becomes a
 * paragraph about saving instead of a saved note.
 *
 * Pure functions: no network, no storage, no DOM.
 */

const SAVE_CUE =
  /\b(save|store|keep)\b|\b(save|store)\s+chey\b|\bnote\s+chey\b|\bnotes?\s+lo\s+(save|pettu)\b|\bpettu\b/i;

const DEICTIC =
  /\b(this|that|it|the answer|the explanation|ee|idi|dini|idi ni|explanation|answer|result|note)\b/i;

export interface SaveIntent {
  /** optional user-supplied title after "as …" or "… ani" */
  title: string | null;
}

/**
 * "save this", "save this as DHRUVA palette notes", "ee explanation notes lo
 * save chey", "dini save chey". A request to save something else ("save the
 * file I uploaded") is not matched, and neither is a question about saving.
 */
export function parseSaveRequest(text: string): SaveIntent | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 220) return null;
  if (clean.endsWith("?")) return null;
  if (!SAVE_CUE.test(clean)) return null;
  // Saving the current answer needs a reference to something already present.
  const refersToContext =
    DEICTIC.test(clean) || /\bthese?\b|\bthe (above|last)\b|\bexplanation\b/i.test(clean);
  if (!refersToContext) return null;
  // "save this for later" is a plan, not a file operation we can verify.
  if (/\b(for later|remind me|tomorrow|later)\b/i.test(clean) && !/\bnotes?\b/i.test(clean)) {
    return null;
  }

  const titled =
    clean.match(/\bas\s+["“]?([^"”]{2,80})["”]?\s*(?:file|note|document)?\s*$/i) ??
    clean.match(/\bname(?:d)?\s+(?:it\s+)?["“]?([^"”]{2,80})["”]?\s*$/i);
  return { title: titled?.[1]?.trim() || null };
}

const REMEMBER_CUE = /\b(remember|note that|keep in mind|gurtu pettuko|gurthu pettuko)\b/i;

/**
 * "remember that the DHRUVA palette is #00E5FF and #05070A", "gurtu pettuko …
 * ". Returns the fact only, without the cue, so the stored text is the fact.
 */
export function parseRememberRequest(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 400) return null;
  const match = clean.match(
    /^(?:please\s+)?(?:hydro[,\s]+)?(?:remember(?:\s+that)?|note that|keep in mind|gurtu pettuko|gurthu pettuko)[,:\s]+(.{3,300})$/i,
  );
  if (!match) return null;
  const fact = match[1].trim().replace(/[.?!]+$/, "");
  return fact.length >= 3 ? fact : null;
}

/**
 * "forget this", "forget my address", "forget that memory". The query is what
 * to match against stored records; an empty query means the most recent one.
 */
export function parseForgetRequest(text: string): { query: string } | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 220) return null;
  // The command must *start* the sentence. "I will never forget that day" is
  // not a request to delete a memory, and treating it as one lost a record.
  const match = clean.match(
    /^(?:please\s+)?(?:hydro[,\s]+)?(?:forget|delete that memory|remove that memory|marichipoyi|marachipo)\b(.*)$/i,
  );
  if (!match) return null;
  const rest = match[1]
    .replace(/^[\s,:]+/, "")
    .replace(/^(?:that\s+memory|about)\b[\s,:]*/i, "")
    .replace(/[.?!]+$/, "")
    .trim();
  // "forget it" / "forget about it" are cancellations, not memory deletes.
  if (/^(it|about it)$/i.test(rest)) return null;
  // "forget that memory" with nothing else means the most recent record.
  return { query: rest };
}

/** Titles for saved notes, so a voice request produces a readable filename. */
export function noteTitle(text: string, fallback: string): string {
  const clean = text.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean).slice(0, 8).join(" ");
  return (words || fallback).slice(0, 80);
}

export const REPLY_LANGUAGES = ["auto", "en", "te", "mixed"] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

export function isReplyLanguage(value: unknown): value is ReplyLanguage {
  return typeof value === "string" && (REPLY_LANGUAGES as readonly string[]).includes(value);
}

/** The system-prompt directive for an explicit reply-language choice. */
export function languageDirective(language: ReplyLanguage): string {
  switch (language) {
    case "en":
      return "REPLY LANGUAGE — the user has chosen English for this session. Answer in English even when the request is in Telugu; keep quoted original wording in its original script.";
    case "te":
      return "REPLY LANGUAGE — the user has chosen Telugu for this session. Answer in Telugu. Keep code, identifiers, file names, commands and technical product names exactly as written in English.";
    case "mixed":
      return "REPLY LANGUAGE — the user has chosen natural Telugu–English mixing for this session. Write the way a bilingual engineer speaks: Telugu sentence structure with English technical terms unchanged.";
    default:
      return "";
  }
}
