/**
 * HYDRO AI — text-derived lip sync.
 *
 * The speech service returns audio without a phoneme timeline, and the app has
 * no forced aligner. So mouth shapes are derived from the text itself with a
 * deterministic grapheme→viseme pass (Latin and Telugu), then advanced against
 * a clock that starts when playback starts. That is an approximation, not a
 * measurement: it is honest about being text-derived, and the measured audio
 * amplitude still scales the jaw so silence never opens the mouth.
 *
 * Visemes are the standard reduced mouth-shape set, grouped by where the sound
 * is articulated. Each one maps to a small mouth shape (jaw / width / rounding /
 * lip press / teeth) that the shader rig blends between.
 */

export type Viseme =
  | "sil"
  | "AA"
  | "E"
  | "I"
  | "O"
  | "U"
  | "MBP"
  | "FV"
  | "TH"
  | "L"
  | "WQ"
  | "R"
  | "S"
  | "SH"
  | "CH"
  | "N"
  | "K"
  | "D"
  | "G";

export interface MouthShape {
  /** 0 closed … 1 wide open */
  jaw: number;
  /** 0 narrow/rounded … 1 wide */
  width: number;
  /** 0 spread … 1 pursed */
  round: number;
  /** 0 relaxed … 1 pressed together */
  press: number;
  /** 0 hidden … 1 upper teeth visible */
  teeth: number;
}

export const REST_MOUTH: MouthShape = { jaw: 0, width: 0.4, round: 0, press: 0.2, teeth: 0 };

const SHAPES: Record<Viseme, MouthShape> = {
  sil: { jaw: 0, width: 0.4, round: 0, press: 0.22, teeth: 0 },
  AA: { jaw: 0.85, width: 0.8, round: 0.1, press: 0, teeth: 0.35 },
  E: { jaw: 0.35, width: 0.86, round: 0, press: 0, teeth: 0.5 },
  I: { jaw: 0.22, width: 0.8, round: 0, press: 0, teeth: 0.45 },
  O: { jaw: 0.7, width: 0.34, round: 0.76, press: 0, teeth: 0.14 },
  U: { jaw: 0.44, width: 0.22, round: 0.9, press: 0, teeth: 0 },
  MBP: { jaw: 0.02, width: 0.45, round: 0.1, press: 0.86, teeth: 0 },
  FV: { jaw: 0.14, width: 0.6, round: 0, press: 0.55, teeth: 0.62 },
  TH: { jaw: 0.2, width: 0.55, round: 0, press: 0.2, teeth: 0.5 },
  L: { jaw: 0.26, width: 0.6, round: 0.05, press: 0, teeth: 0.3 },
  WQ: { jaw: 0.15, width: 0.16, round: 0.95, press: 0.1, teeth: 0 },
  R: { jaw: 0.2, width: 0.4, round: 0.5, press: 0.15, teeth: 0.2 },
  S: { jaw: 0.1, width: 0.7, round: 0, press: 0.3, teeth: 0.78 },
  SH: { jaw: 0.16, width: 0.55, round: 0.35, press: 0.25, teeth: 0.4 },
  CH: { jaw: 0.16, width: 0.45, round: 0.45, press: 0.2, teeth: 0.35 },
  N: { jaw: 0.12, width: 0.5, round: 0.05, press: 0.2, teeth: 0.3 },
  K: { jaw: 0.3, width: 0.5, round: 0.1, press: 0, teeth: 0.2 },
  D: { jaw: 0.24, width: 0.55, round: 0.05, press: 0.05, teeth: 0.35 },
  G: { jaw: 0.36, width: 0.5, round: 0.25, press: 0, teeth: 0.15 },
};

export function visemeShape(viseme: Viseme): MouthShape {
  return { ...SHAPES[viseme] };
}

const DIGRAPHS: Array<[string, Viseme]> = [
  ["ough", "O"],
  ["augh", "O"],
  ["tch", "CH"],
  ["sch", "SH"],
  ["sh", "SH"],
  ["ch", "CH"],
  ["th", "TH"],
  ["ph", "FV"],
  ["wh", "WQ"],
  ["ng", "N"],
  ["qu", "WQ"],
  ["oo", "U"],
  ["ee", "I"],
  ["ea", "I"],
  ["ie", "I"],
  ["ai", "E"],
  ["ay", "E"],
  ["ou", "O"],
  ["ow", "O"],
  ["oi", "O"],
  ["oy", "O"],
  ["au", "O"],
  ["aw", "O"],
  ["oa", "O"],
  ["ue", "U"],
  ["ck", "K"],
];

const LATIN: Record<string, Viseme> = {
  a: "AA",
  e: "E",
  i: "I",
  o: "O",
  u: "U",
  y: "I",
  b: "MBP",
  m: "MBP",
  p: "MBP",
  f: "FV",
  v: "FV",
  w: "WQ",
  l: "L",
  r: "R",
  s: "S",
  z: "S",
  k: "K",
  c: "K",
  q: "K",
  g: "G",
  d: "D",
  t: "D",
  n: "N",
  h: "AA",
  j: "SH",
  x: "K",
};

/**
 * Telugu script (U+0C00–U+0C7F). Independent vowels and matras map to the
 * matching viseme; consonants keep their place of articulation. This is a
 * visual approximation for lip sync only — it is not a transliteration engine.
 */
const TELUGU: Record<string, Viseme> = {
  "అ": "AA", "ఆ": "AA", "ా": "AA",
  "ఇ": "I", "ఈ": "I", "ి": "I", "ీ": "I",
  "ఉ": "U", "ఊ": "U", "ు": "U", "ూ": "U",
  "ఋ": "R", "ృ": "R",
  "ఎ": "E", "ఏ": "E", "ె": "E", "ే": "E",
  "ఐ": "E", "ై": "E",
  "ఒ": "O", "ఓ": "O", "ొ": "O", "ో": "O",
  "ఔ": "O", "ౌ": "O",
  "ం": "N", "ః": "AA", "ఁ": "N",
  "క": "K", "ఖ": "K", "గ": "G", "ఘ": "G", "ఙ": "N",
  "చ": "CH", "ఛ": "CH", "జ": "SH", "ఝ": "SH", "ఞ": "N",
  "ట": "D", "ఠ": "D", "డ": "D", "ఢ": "D", "ణ": "N",
  "త": "D", "థ": "TH", "ద": "D", "ధ": "D", "న": "N",
  "ప": "MBP", "ఫ": "FV", "బ": "MBP", "భ": "MBP", "మ": "MBP",
  "య": "I", "ర": "R", "ఱ": "R", "ల": "L", "ళ": "L", "వ": "WQ",
  "శ": "S", "ష": "S", "స": "S", "హ": "AA",
  "్": "sil",
};

export interface VisemeCue {
  viseme: Viseme;
  /** ms from the start of the utterance */
  start: number;
  end: number;
  /** 0…1 emphasis, used to widen/heighten the shape slightly */
  stress: number;
}

export interface VisemeOptions {
  /** speech rate multiplier from the prosody layer */
  rate?: number;
  /** hard cap so a pasted essay cannot build a huge timeline */
  maxUnits?: number;
}

const BASE_UNIT_MS = 62;
const WORD_GAP_MS = 38;

function isTelugu(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x0c00 && code <= 0x0c7f;
}

function isLatinLetter(ch: string): boolean {
  return /[a-z']/i.test(ch);
}

/** Sound units for one Latin word, with silent-final-e handling. */
function latinUnits(word: string): Viseme[] {
  const lower = word.toLowerCase();
  const units: Viseme[] = [];
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    for (const [pattern, viseme] of DIGRAPHS) {
      if (lower.startsWith(pattern, i)) {
        // "ng" at the start of a word is two sounds ("ng" rarely starts English)
        if (pattern === "ng" && i === 0) continue;
        units.push(viseme);
        i += pattern.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = lower[i];
    if (ch === "'" || ch === "-") {
      i += 1;
      continue;
    }
    const viseme = LATIN[ch];
    if (viseme) units.push(viseme);
    i += 1;
  }

  // Silent final "e" ("make", "time") — dropped so the mouth closes cleanly.
  if (
    units.length > 2 &&
    lower.endsWith("e") &&
    !/[aeiou]e$/.test(lower) &&
    LATIN[lower[lower.length - 2]] &&
    !"aeiouy".includes(lower[lower.length - 2])
  ) {
    units.pop();
  }
  return units;
}

function teluguUnits(word: string): Viseme[] {
  const units: Viseme[] = [];
  for (const ch of word) {
    const viseme = TELUGU[ch];
    if (viseme) units.push(viseme);
  }
  return units;
}

/**
 * Deterministic viseme timeline for a sentence.
 *
 * Punctuation becomes a real pause instead of a sound, and capitals or a
 * following "!" raise the stress of that word.
 */
export function textToVisemes(text: string, options: VisemeOptions = {}): VisemeCue[] {
  const rate = Math.max(0.7, Math.min(1.3, options.rate ?? 1));
  const maxUnits = options.maxUnits ?? 420;
  const words = text.split(/\s+/).filter(Boolean);
  const cues: VisemeCue[] = [];
  let t = 0;
  let emitted = 0;

  const push = (viseme: Viseme, stress: number, duration: number) => {
    if (emitted >= maxUnits) return;
    cues.push({ viseme, start: t, end: t + duration, stress });
    t += duration;
    emitted += 1;
  };

  for (let w = 0; w < words.length; w++) {
    const raw = words[w];
    const trailing = raw.match(/[.,;:!?…]+$/)?.[0] ?? "";
    const bare = raw.replace(/[.,;:!?…]+$/, "").replace(/^[("'“]+/, "");
    if (!bare) {
      const pause = /[.!?…]/.test(trailing) ? 260 : 130;
      t += pause / rate;
      continue;
    }

    const shouted = bare.length > 2 && bare === bare.toUpperCase();
    const stress = Math.min(1, (shouted ? 0.6 : 0.2) + (trailing.includes("!") ? 0.35 : 0));
    const units: Viseme[] = [];
    let latinBuffer = "";

    const flush = () => {
      if (!latinBuffer) return;
      units.push(...latinUnits(latinBuffer));
      latinBuffer = "";
    };

    for (const ch of bare) {
      if (isTelugu(ch)) {
        flush();
        const viseme = TELUGU[ch];
        if (viseme) units.push(viseme);
      } else if (isLatinLetter(ch)) {
        latinBuffer += ch;
      } else {
        flush();
      }
    }
    flush();

    for (const viseme of units) {
      const vowel = viseme === "AA" || viseme === "E" || viseme === "I" || viseme === "O" || viseme === "U";
      const duration = ((vowel ? BASE_UNIT_MS + 12 : BASE_UNIT_MS) * (1 + stress * 0.18)) / rate;
      push(viseme, stress, duration);
    }

    if (trailing) {
      const pause = /[.!?…]/.test(trailing) ? 260 : /[,;:]/.test(trailing) ? 130 : 80;
      t += pause / rate;
    } else if (w < words.length - 1) {
      t += WORD_GAP_MS / rate;
    }
  }

  // Always end in silence so the mouth closes.
  if (cues.length) {
    cues.push({ viseme: "sil", start: t, end: t + 60, stress: 0 });
  }
  return cues;
}

export function timelineDuration(cues: VisemeCue[]): number {
  return cues.length ? cues[cues.length - 1].end : 0;
}

function mixShape(a: MouthShape, b: MouthShape, k: number): MouthShape {
  const amount = Math.max(0, Math.min(1, k));
  return {
    jaw: a.jaw + (b.jaw - a.jaw) * amount,
    width: a.width + (b.width - a.width) * amount,
    round: a.round + (b.round - a.round) * amount,
    press: a.press + (b.press - a.press) * amount,
    teeth: a.teeth + (b.teeth - a.teeth) * amount,
  };
}

/**
 * Mouth shape at `timeMs` after the utterance started. Boundaries are blended
 * over 34 ms so the mouth glides between visemes instead of stepping.
 */
export function mouthAt(cues: VisemeCue[], timeMs: number): MouthShape {
  if (!cues.length || timeMs < 0) return { ...REST_MOUTH };
  if (timeMs >= timelineDuration(cues)) return { ...REST_MOUTH };

  let index = 0;
  // Cues are sorted and non-overlapping; a linear scan is cheaper than a
  // binary search at the sizes this timeline actually reaches.
  for (let i = 0; i < cues.length; i++) {
    if (timeMs < cues[i].end) {
      index = i;
      break;
    }
    index = i;
  }
  const cue = cues[index];
  const shape = SHAPES[cue.viseme];
  const stress = 1 + cue.stress * 0.12;
  const scaled: MouthShape = {
    jaw: shape.jaw * stress,
    width: shape.width,
    round: shape.round,
    press: shape.press,
    teeth: shape.teeth,
  };

  const blendWindow = 34;
  const sinceStart = timeMs - cue.start;
  if (sinceStart < blendWindow && index > 0) {
    const previous = SHAPES[cues[index - 1].viseme];
    return mixShape(previous, scaled, sinceStart / blendWindow);
  }
  return scaled;
}
