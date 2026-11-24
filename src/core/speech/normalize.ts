/**
 * HYDRO AI — speech text normalisation.
 *
 * A text answer is not speakable text. Markdown, fenced code, URLs, tables,
 * `₹1,250`, `12/03/2026`, `2+3=5` and `40%` are all read out literally if they
 * reach a synthesizer, which is the "robotic reader" complaint in its most
 * common form. This module rewrites them into words *in the target language*
 * before synthesis and reports what it changed, so the inspector can show it.
 *
 * Numbers are converted for English, Hindi and Telugu. For any other language
 * the numerals are left as digits on purpose: a Turkish or Japanese voice reads
 * digits natively, and inventing number words for a language this build has not
 * verified would be worse than leaving them alone.
 */

export interface NormalizedSpeech {
  text: string;
  /** human-readable list of the rewrites that were applied */
  notes: string[];
  /** original length, for the inspector */
  originalChars: number;
}

/* ────────────────────────────── number words ───────────────────────────── */

interface NumberWords {
  zero: string;
  units: string[];
  teens: string[];
  tens: string[];
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
  /** Telugu inflects the scale word for a multiplier above one */
  hundredPlural?: string;
  thousandPlural?: string;
  lakhPlural?: string;
  crorePlural?: string;
  million?: string;
  billion?: string;
  point: string;
  and: string;
  indianGrouping: boolean;
}

const EN: NumberWords = {
  zero: "zero",
  units: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
  teens: [
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
  ],
  tens: ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"],
  hundred: "hundred",
  thousand: "thousand",
  lakh: "lakh",
  crore: "crore",
  million: "million",
  billion: "billion",
  point: "point",
  and: "and",
  indianGrouping: false,
};

const HI: NumberWords = {
  zero: "शून्य",
  units: ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ"],
  teens: [
    "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  ],
  tens: ["", "", "बीस", "तीस", "चालीस", "पचास", "साठ", "सत्तर", "अस्सी", "नब्बे"],
  hundred: "सौ",
  thousand: "हज़ार",
  lakh: "लाख",
  crore: "करोड़",
  point: "दशमलव",
  and: "और",
  indianGrouping: true,
};

const TE: NumberWords = {
  zero: "సున్నా",
  units: ["సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది"],
  teens: [
    "పది", "పదకొండు", "పన్నెండు", "పదమూడు", "పద్నాలుగు", "పదిహేను",
    "పదహారు", "పదిహేడు", "పద్దెనిమిది", "పంతొమ్మిది",
  ],
  tens: ["", "", "ఇరవై", "ముప్పై", "నలభై", "యాభై", "అరవై", "డెబ్బై", "ఎనభై", "తొంభై"],
  hundred: "వంద",
  thousand: "వెయ్యి",
  lakh: "లక్ష",
  crore: "కోటి",
  hundredPlural: "వందల",
  thousandPlural: "వేల",
  lakhPlural: "లక్షల",
  crorePlural: "కోట్లు",
  point: "పాయింట్",
  and: "మరియు",
  indianGrouping: true,
};

const WORDS: Record<string, NumberWords> = { en: EN, hi: HI, te: TE };

function wordsFor(language: string): NumberWords | null {
  return WORDS[language.split("-")[0]!] ?? null;
}

function twoDigit(n: number, w: NumberWords): string {
  if (n < 10) return w.units[n]!;
  if (n < 20) return w.teens[n - 10]!;
  const tens = w.tens[Math.floor(n / 10)]!;
  const unit = n % 10;
  return unit ? `${tens} ${w.units[unit]}` : tens;
}

function belowThousand(n: number, w: NumberWords): string {
  if (n < 100) return twoDigit(n, w);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const scale = hundreds > 1 ? (w.hundredPlural ?? w.hundred) : w.hundred;
  const base = `${w.units[hundreds]} ${scale}`;
  return rest ? `${base} ${twoDigit(rest, w)}` : base;
}

/** Integer → words. Returns null when the language has no number lexicon. */
export function numberToWords(value: number, language: string): string | null {
  const w = wordsFor(language);
  if (!w || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (Math.abs(n) > 999_999_999_999) return null;
  if (n === 0) return w.zero;

  const words: string[] = [];

  if (w.indianGrouping) {
    let rest = n;
    const crore = Math.floor(rest / 10_000_000);
    rest %= 10_000_000;
    const lakh = Math.floor(rest / 100_000);
    rest %= 100_000;
    const thousand = Math.floor(rest / 1000);
    rest %= 1000;
    if (crore) {
      words.push(`${belowThousand(crore, w)} ${crore > 1 ? (w.crorePlural ?? w.crore) : w.crore}`);
    }
    if (lakh) words.push(`${twoDigit(lakh, w)} ${lakh > 1 ? (w.lakhPlural ?? w.lakh) : w.lakh}`);
    if (thousand) {
      words.push(`${belowThousand(thousand, w)} ${thousand > 1 ? (w.thousandPlural ?? w.thousand) : w.thousand}`);
    }
    if (rest) words.push(belowThousand(rest, w));
    return words.join(" ");
  }

  let rest = n;
  const billion = Math.floor(rest / 1_000_000_000);
  rest %= 1_000_000_000;
  const million = Math.floor(rest / 1_000_000);
  rest %= 1_000_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (billion) words.push(`${belowThousand(billion, w)} ${w.billion}`);
  if (million) words.push(`${belowThousand(million, w)} ${w.million}`);
  if (thousand) words.push(`${belowThousand(thousand, w)} ${w.thousand}`);
  if (rest) words.push(belowThousand(rest, w));
  return words.join(" ");
}

/** "3.5" → "three point five" / "तीन दशमलव पाँच". */
export function decimalToWords(raw: string, language: string): string | null {
  const w = wordsFor(language);
  if (!w) return null;
  const clean = raw.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
  const negative = clean.startsWith("-");
  const [whole, fraction] = (negative ? clean.slice(1) : clean).split(".");
  const wholeWords = numberToWords(Number(whole), language);
  if (wholeWords === null) return null;
  if (!fraction) return `${negative ? "-" : ""}${wholeWords}`;
  const digits = [...fraction].map((d) => w.units[Number(d)] ?? d).join(" ");
  return `${negative ? "-" : ""}${wholeWords} ${w.point} ${digits}`;
}

/* ──────────────────────────── markup + symbols ─────────────────────────── */

const EMOJI = /[\u{1f000}-\u{1faff}\u{2600}-\u{27bf}\u{2b00}-\u{2bff}\u{fe0f}\u{200d}]/gu;

/** Remove everything that has no spoken form, keeping the words. */
function stripMarkup(text: string): { text: string; changed: boolean } {
  const before = text;
  let out = text;

  // Fenced code: spoken as a marker, never read line by line.
  out = out.replace(/```[\s\S]*?```/g, " code block. ");
  out = out.replace(/~~~[\s\S]*?~~~/g, " code block. ");
  // Inline code keeps its content: it is usually a name worth saying.
  out = out.replace(/`([^`]+)`/g, "$1");
  // Images then links.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  out = out.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1");
  // Bare URLs and e-mail addresses.
  out = out.replace(/https?:\/\/\S+/g, " the link ");
  out = out.replace(/\bwww\.\S+/g, " the link ");
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " an email address ");
  // HTML tags.
  out = out.replace(/<\/?[a-z][^>]*>/gi, " ");
  // Tables: cells become clauses.
  out = out.replace(/^\s*\|(.+)\|\s*$/gm, (_m, row: string) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell && !/^:?-{2,}:?$/.test(cell))
      .join(", "),
  );
  // Headings, quotes, list bullets, emphasis markers, horizontal rules.
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  out = out.replace(/^\s{0,3}>\s?/gm, "");
  out = out.replace(/^\s*[-*+]\s+/gm, "");
  out = out.replace(/^\s*\d+[.)]\s+/gm, "");
  out = out.replace(/^\s*([-*_])\1{2,}\s*$/gm, " ");
  out = out.replace(/(\*\*\*|\*\*|__|\*|_)(.+?)\1/gs, "$2");
  out = out.replace(/<\/?[^>]+>/g, " ");
  // Zero-width and bidi marks.
  out = out.replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "");
  out = out.replace(EMOJI, " ");

  return { text: out, changed: out !== before };
}

const CURRENCY: Record<string, { en: [string, string]; hi: [string, string]; te: [string, string] }> = {
  "₹": { en: ["rupee", "rupees"], hi: ["रुपया", "रुपये"], te: ["రూపాయి", "రూపాయలు"] },
  $: { en: ["dollar", "dollars"], hi: ["डॉलर", "डॉलर"], te: ["డాలర్", "డాలర్లు"] },
  "€": { en: ["euro", "euros"], hi: ["यूरो", "यूरो"], te: ["యూరో", "యూరోలు"] },
  "£": { en: ["pound", "pounds"], hi: ["पाउंड", "पाउंड"], te: ["పౌండ్", "పౌండ్లు"] },
  "¥": { en: ["yen", "yen"], hi: ["येन", "येन"], te: ["యెన్", "యెన్"] },
  Rs: { en: ["rupee", "rupees"], hi: ["रुपया", "रुपये"], te: ["రూపాయి", "రూపాయలు"] },
};

const PERCENT: Record<string, string> = { en: "percent", hi: "प्रतिशत", te: "శాతం" };

const UNITS: Record<string, Record<string, string>> = {
  km: { en: "kilometres", hi: "किलोमीटर", te: "కిలోమీటర్లు" },
  kg: { en: "kilograms", hi: "किलोग्राम", te: "కిలోలు" },
  cm: { en: "centimetres", hi: "सेंटीमीटर", te: "సెంటీమీటర్లు" },
  mm: { en: "millimetres", hi: "मिलीमीटर", te: "మిల్లీమీటర్లు" },
  mb: { en: "megabytes", hi: "मेगाबाइट", te: "మెగాబైట్లు" },
  gb: { en: "gigabytes", hi: "गीगाबाइट", te: "గీగాబైట్లు" },
  tb: { en: "terabytes", hi: "टेराबाइट", te: "టెరాబైట్లు" },
  kb: { en: "kilobytes", hi: "किलोबाइट", te: "కిలోబైట్లు" },
  ms: { en: "milliseconds", hi: "मिलीसेकंड", te: "మిల్లీసెకన్లు" },
  hz: { en: "hertz", hi: "हर्ट्ज़", te: "హెర్ట్జ్" },
  khz: { en: "kilohertz", hi: "किलोहर्ट्ज़", te: "కిలోహెర్ట్జ్" },
  ghz: { en: "gigahertz", hi: "गीगाहर्ट्ज़", te: "గీగాహెర్ట్జ్" },
  "°c": { en: "degrees Celsius", hi: "डिग्री सेल्सियस", te: "డిగ్రీల సెల్సియస్" },
  "°f": { en: "degrees Fahrenheit", hi: "डिग्री फ़ारेनहाइट", te: "డిగ్రీల ఫారెన్‌హీట్" },
};

const MONTHS: Record<string, Record<string, string>> = {
  en: {
    "1": "January", "2": "February", "3": "March", "4": "April", "5": "May", "6": "June",
    "7": "July", "8": "August", "9": "September", "10": "October", "11": "November", "12": "December",
  },
  hi: {
    "1": "जनवरी", "2": "फ़रवरी", "3": "मार्च", "4": "अप्रैल", "5": "मई", "6": "जून",
    "7": "जुलाई", "8": "अगस्त", "9": "सितंबर", "10": "अक्टूबर", "11": "नवंबर", "12": "दिसंबर",
  },
  te: {
    "1": "జనవరి", "2": "ఫిబ్రవరి", "3": "మార్చి", "4": "ఏప్రిల్", "5": "మే", "6": "జూన్",
    "7": "జూలై", "8": "ఆగస్టు", "9": "సెప్టెంబర్", "10": "అక్టోబర్", "11": "నవంబర్", "12": "డిసెంబర్",
  },
};

const OPERATORS: Record<string, Record<string, string>> = {
  "+": { en: "plus", hi: "जमा", te: "ప్లస్" },
  "-": { en: "minus", hi: "घटा", te: "మైనస్" },
  "*": { en: "times", hi: "गुणा", te: "గుణించి" },
  "/": { en: "divided by", hi: "भाग", te: "భాగించి" },
  "=": { en: "equals", hi: "बराबर", te: "సమానం" },
  "<": { en: "less than", hi: "से कम", te: "కంటే తక్కువ" },
  ">": { en: "greater than", hi: "से अधिक", te: "కంటే ఎక్కువ" },
  "%": { en: "percent", hi: "प्रतिशत", te: "శాతం" },
};

function op(word: string, language: string): string {
  return OPERATORS[word]?.[language] ?? OPERATORS[word]?.en ?? word;
}

export interface NormalizeOptions {
  /**
   * Set false to strip markup only. The caller then normalises numbers per
   * language run, which is what keeps "₹1,250" English in an English sentence
   * and Telugu in a Telugu one inside the same mixed answer.
   */
  numbers?: boolean;
}

/**
 * Normalise one answer for speech.
 * Deterministic and side-effect free: the same input always gives the same
 * output, which is what makes it testable.
 */
export function normalizeForSpeech(
  input: string,
  language = "en",
  options: NormalizeOptions = {},
): NormalizedSpeech {
  const lang = language.split("-")[0]!;
  const notes: string[] = [];
  const originalChars = input.length;
  let text = input;

  const markup = stripMarkup(text);
  text = markup.text;
  if (markup.changed) notes.push("markdown, links, tables and emoji removed");

  if (options.numbers === false) {
    // Markup only: numbers, currency, dates and units are left for the
    // per-language pass.
    const stripped = text
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/ +([,.;:!?])/g, "$1")
      .trim();
    return { text: stripped, notes, originalChars };
  }

  // ── currency ──────────────────────────────────────────────────────────────
  let currencyHits = 0;
  for (const [symbol, forms] of Object.entries(CURRENCY)) {
    const pattern = new RegExp(`(?:${symbol === "$" ? "\\$" : symbol})\\s?(\\d[\\d,]*(?:\\.\\d+)?)(\\s?(?:lakh|crore|million|billion|k))?`, "gi");
    text = text.replace(pattern, (_match, amount: string, suffix: string | undefined) => {
      const numeric = Number(amount.replace(/,/g, ""));
      if (!Number.isFinite(numeric)) return _match;
      let value = numeric;
      let scale = "";
      const unit = (suffix ?? "").trim().toLowerCase();
      if (unit === "k") value *= 1000;
      if (unit === "million") { value *= 1_000_000; scale = "million"; }
      if (unit === "billion") { value *= 1_000_000_000; scale = "billion"; }
      if (unit === "lakh") { value *= 100_000; scale = "lakh"; }
      if (unit === "crore") { value *= 10_000_000; scale = "crore"; }
      const words = numberToWords(value, lang);
      if (words === null) return _match;
      const formsForLang = forms[lang as "en" | "hi" | "te"] ?? forms.en;
      const plural = value === 1 ? formsForLang[0] : formsForLang[1];
      const tail = scale ? ` ${scale}` : "";
      currencyHits += 1;
      return ` ${words}${tail} ${plural} `;
    });
  }
  if (currencyHits) notes.push(`currency spoken as words (${currencyHits})`);

  // ── percent ───────────────────────────────────────────────────────────────
  const percentWord = PERCENT[lang] ?? PERCENT.en!;
  let percentHits = 0;
  text = text.replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g, (_m, amount: string) => {
    const words = decimalToWords(amount, lang);
    percentHits += 1;
    return words ? `${words} ${percentWord}` : _m;
  });

  // ── ISO and day-first dates ───────────────────────────────────────────────
  const months = MONTHS[lang] ?? MONTHS.en!;
  let dateHits = 0;
  text = text.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (_m, y: string, m: string, d: string) => {
    const month = months[String(Number(m))];
    if (!month) return _m;
    const day = numberToWords(Number(d), lang);
    const year = numberToWords(Number(y), lang);
    if (!day || !year) return _m;
    dateHits += 1;
    return `${day} ${month} ${year}`;
  });
  text = text.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_m, d: string, m: string, y: string) => {
    const month = months[String(Number(m))];
    if (!month || Number(d) > 31) return _m;
    const day = numberToWords(Number(d), lang);
    const year = numberToWords(Number(y), lang);
    if (!day || !year) return _m;
    dateHits += 1;
    return `${day} ${month} ${year}`;
  });
  if (dateHits) notes.push(`dates spoken day-first (${dateHits})`);

  // ── clock times ───────────────────────────────────────────────────────────
  let timeHits = 0;
  text = text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_m, h: string, min: string) => {
    const hour24 = Number(h);
    const minute = Number(min);
    if (hour24 > 23) return _m;
    if (lang === "en") {
      const suffix = hour24 < 12 ? "AM" : "PM";
      const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
      const hourWord = numberToWords(hour12, "en");
      const minuteWord = minute === 0 ? "" : ` ${numberToWords(minute, "en")}`;
      timeHits += 1;
      return `${hourWord}${minuteWord ? ` oh${minuteWord}` : ""} ${suffix}`.replace(" oh ", " ");
    }
    const hourWord = numberToWords(hour24, lang);
    const minuteWord = numberToWords(minute, lang);
    if (!hourWord || !minuteWord) return _m;
    timeHits += 1;
    if (lang === "hi") return minute === 0 ? `${hourWord} बजे` : `${hourWord} बजकर ${minuteWord} मिनट`;
    if (lang === "te") return minute === 0 ? `${hourWord} గంటలు` : `${hourWord} గంటల ${minuteWord} నిమిషాలు`;
    return _m;
  });
  if (timeHits) notes.push(`clock times spoken (${timeHits})`);

  // ── units ────────────────────────────────────────────────────────────────
  let unitHits = 0;
  for (const [unit, forms] of Object.entries(UNITS)) {
    const word = forms[lang] ?? forms.en;
    if (!word) continue;
    const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s?${escaped}\\b`, "gi");
    text = text.replace(pattern, (match, amount: string) => {
      const words = decimalToWords(amount, lang);
      if (!words) return match;
      unitHits += 1;
      return `${words} ${word}`;
    });
  }
  if (unitHits) notes.push(`units expanded (${unitHits})`);

  // ── arithmetic ───────────────────────────────────────────────────────────
  let mathHits = 0;
  // A chained expression ("2 + 3 = 5") is read as a whole. Handling one
  // operator pair at a time left the second operator stranded ("two plus three
  // = five"), which the synthesizer then read as a symbol.
  text = text.replace(
    /(?<![\p{L}\d])(\d+(?:\.\d+)?(?:\s*[+\-*/=<>]\s*\d+(?:\.\d+)?)+)(?![\p{L}\d])/gu,
    (match, expression: string) => {
      const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/=<>]/g) ?? [];
      if (tokens.length < 3) return match;
      const spoken = tokens.map((token) =>
        /^[+\-*/=<>]$/.test(token) ? op(token, lang) : decimalToWords(token, lang),
      );
      if (spoken.some((word) => !word)) return match;
      mathHits += 1;
      return spoken.join(" ");
    },
  );
  // Exponents: "x^2" → "x squared"
  text = text.replace(/(\b[\p{L}\p{N}]+)\s*\^\s*(\d+)/gu, (match, base: string, power: string) => {
    const n = Number(power);
    if (lang === "en") {
      mathHits += 1;
      if (n === 2) return `${base} squared`;
      if (n === 3) return `${base} cubed`;
      return `${base} to the power of ${numberToWords(n, "en") ?? power}`;
    }
    return match;
  });
  if (mathHits) notes.push(`arithmetic narrated (${mathHits})`);

  // ── remaining numbers ────────────────────────────────────────────────────
  // Only plain integers and decimals that are not part of an identifier.
  let numberHits = 0;
  text = text.replace(/(?<![\p{L}\p{N}_.#])(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?(?![\p{L}\p{N}_])/gu, (
    match,
    whole: string,
    fraction: string | undefined,
  ) => {
    const words = decimalToWords(`${whole.replace(/,/g, "")}${fraction ?? ""}`, lang);
    if (words === null) return match;
    numberHits += 1;
    return words;
  });
  if (numberHits) notes.push(`numbers spoken (${numberHits})`);

  // ── tidy ─────────────────────────────────────────────────────────────────
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +([,.;:!?])/g, "$1")
    .trim();

  return { text, notes, originalChars };
}
