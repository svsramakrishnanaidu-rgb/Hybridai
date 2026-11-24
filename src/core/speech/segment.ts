/**
 * HYDRO AI — speech segmentation.
 *
 * A language model writes one long answer. A speech pipeline wants short units:
 * the first sentence can be synthesised and played while the rest is still being
 * generated, and each unit gets its own clear intonation contour. This module
 * turns an answer into those units without breaking the things that must stay
 * whole (numbers, URLs, abbreviations, code identifiers).
 */

export interface SpeechSegment {
  /** text handed to the synthesizer */
  text: string;
  /** 0-based position in the utterance */
  index: number;
  /** true for the final segment of the answer */
  last: boolean;
}

export interface SegmentOptions {
  /** hard cap per unit; the provider rejects very long inputs */
  maxChars?: number;
  /** units shorter than this are merged with the next one */
  minChars?: number;
}

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "fig",
  "no", "approx", "inc", "ltd", "co", "dept", "est", "al", "cf", "resp", "min", "max",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** Sentence enders across the scripts this app speaks. */
const TERMINATORS = /[.!?…।॥።]/;

function endsWithAbbreviation(text: string): boolean {
  const match = text.match(/([A-Za-z.]+)\.$/);
  if (!match) return false;
  const word = match[1]!.toLowerCase().replace(/\.$/, "");
  if (!word) return false;
  // A single capital letter is an initial ("A. P. J."), not a sentence end.
  if (/^[A-Z]$/.test(match[1]!)) return true;
  return ABBREVIATIONS.has(word);
}

function isDecimalPoint(text: string, index: number): boolean {
  const before = text[index - 1];
  const after = text[index + 1];
  return Boolean(before && after && /\d/.test(before) && /\d/.test(after));
}

/**
 * Sentence split that respects decimals, abbreviations, code and quotes.
 * Punctuation is kept on the segment: the synthesizer uses it for intonation.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buffer = "";
  let inCode = false;
  let quote: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (ch === "`") {
      inCode = !inCode;
      buffer += ch;
      continue;
    }
    if (inCode) {
      buffer += ch;
      continue;
    }
    if (ch === '"' || ch === "“" || ch === "”") {
      quote = quote ? null : ch;
      buffer += ch;
      continue;
    }

    buffer += ch;
    if (!TERMINATORS.test(ch)) continue;
    if (ch === "." && (isDecimalPoint(text, i) || endsWithAbbreviation(buffer.trim()))) continue;

    // Consume trailing closing punctuation and quotes.
    while (i + 1 < text.length && /["'”’)\]]/.test(text[i + 1]!)) {
      i += 1;
      buffer += text[i];
    }
    const trimmed = buffer.trim();
    if (trimmed) out.push(trimmed);
    buffer = "";
    quote = null;
  }
  if (buffer.trim()) out.push(buffer.trim());

  // A trailing quote that never closed is not a reason to drop text.
  return out.filter((sentence) => /\S/.test(sentence));
}

/** Split one over-long sentence at commas or spaces, never mid-word. */
function splitLong(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // Prefer a clause boundary, then a word boundary.
    const clause = Math.max(
      window.lastIndexOf(", "),
      window.lastIndexOf("; "),
      window.lastIndexOf(" — "),
      window.lastIndexOf(" కానీ "),
    );
    const cut = clause > maxChars * 0.4 ? clause + 1 : window.lastIndexOf(" ");
    const at = cut > 0 ? cut : maxChars;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

/**
 * Plan the spoken units for one answer.
 *
 * Short fragments are merged forward ("Yes." alone gives a clipped one-word
 * utterance), and each segment keeps the neighbouring text as prosody context so
 * the synthesizer can carry intonation across a boundary instead of restarting.
 */
export function planSegments(text: string, options: SegmentOptions = {}): SpeechSegment[] {
  const maxChars = Math.max(80, Math.min(600, options.maxChars ?? 240));
  const minChars = Math.max(8, Math.min(120, options.minChars ?? 24));

  const sentences = splitSentences(text.replace(/\r\n/g, "\n"));
  const units: string[] = [];
  let pending = "";

  for (const sentence of sentences) {
    for (const piece of splitLong(sentence, maxChars)) {
      const candidate = pending ? `${pending} ${piece}` : piece;
      if (candidate.length < minChars && !/\?$/.test(candidate)) {
        pending = candidate;
        continue;
      }
      units.push(candidate);
      pending = "";
    }
  }
  if (pending) {
    if (units.length) units[units.length - 1] = `${units[units.length - 1]} ${pending}`;
    else units.push(pending);
  }

  return units.map((unit, index) => ({
    text: unit,
    index,
    last: index === units.length - 1,
  }));
}

/** Prosody context for one segment, so chunks join instead of restarting. */
export function prosodyContext(segments: SpeechSegment[], index: number): {
  previousText: string;
  nextText: string;
} {
  const previous = index > 0 ? segments[index - 1]!.text : "";
  const next = index + 1 < segments.length ? segments[index + 1]!.text : "";
  const tail = (value: string) => (value.length > 160 ? value.slice(-160) : value);
  const head = (value: string) => (value.length > 160 ? value.slice(0, 160) : value);
  return { previousText: tail(previous), nextText: head(next) };
}

/** Character budget for one spoken answer, so a pasted book cannot be billed. */
export function clampForSpeech(text: string, limit = 4000): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return lastStop > limit * 0.6 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
}
