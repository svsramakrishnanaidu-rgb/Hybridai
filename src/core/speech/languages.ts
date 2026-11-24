/**
 * HYDRO AI — language and script intelligence for speech.
 *
 * Speech is not text: a synthesizer needs to know which language it is reading
 * before it can choose a model, and a mixed Telugu-English sentence needs the
 * Telugu part in Telugu script. This module answers three questions with
 * deterministic rules:
 *
 *   1. which writing systems does this text contain (Unicode ranges),
 *   2. which language does each run belong to,
 *   3. is this Latin text actually romanised Telugu ("nenu", "chesthunna").
 *
 * It makes no claim to understand the sentence. Everything here is script
 * counting plus a curated Roman-Telugu lexicon, so a wrong guess is explainable
 * and testable — and the caller can always override the language explicitly.
 */

export type ScriptId =
  | "latin"
  | "telugu"
  | "devanagari"
  | "bengali"
  | "tamil"
  | "kannada"
  | "malayalam"
  | "gujarati"
  | "gurmukhi"
  | "oriya"
  | "arabic"
  | "hebrew"
  | "thai"
  | "cyrillic"
  | "hangul"
  | "kana"
  | "han"
  | "other";

interface ScriptRange {
  script: ScriptId;
  from: number;
  to: number;
}

/** BMP ranges that matter for the languages this app claims to speak. */
const RANGES: ScriptRange[] = [
  { script: "telugu", from: 0x0c00, to: 0x0c7f },
  { script: "devanagari", from: 0x0900, to: 0x097f },
  { script: "bengali", from: 0x0980, to: 0x09ff },
  { script: "gurmukhi", from: 0x0a00, to: 0x0a7f },
  { script: "gujarati", from: 0x0a80, to: 0x0aff },
  { script: "oriya", from: 0x0b00, to: 0x0b7f },
  { script: "tamil", from: 0x0b80, to: 0x0bff },
  { script: "kannada", from: 0x0c80, to: 0x0cff },
  { script: "malayalam", from: 0x0d00, to: 0x0d7f },
  { script: "arabic", from: 0x0600, to: 0x06ff },
  { script: "hebrew", from: 0x0590, to: 0x05ff },
  { script: "thai", from: 0x0e00, to: 0x0e7f },
  { script: "cyrillic", from: 0x0400, to: 0x04ff },
  { script: "hangul", from: 0xac00, to: 0xd7af },
  { script: "kana", from: 0x3040, to: 0x30ff },
  { script: "han", from: 0x4e00, to: 0x9fff },
  { script: "latin", from: 0x0041, to: 0x024f },
];

export function scriptOf(ch: string): ScriptId {
  const code = ch.codePointAt(0) ?? 0;
  for (const range of RANGES) {
    if (code >= range.from && code <= range.to) return range.script;
  }
  return "other";
}

/** Scripts that are written without spaces between words. */
const UNSPACED: ReadonlySet<ScriptId> = new Set(["thai", "han", "kana"]);

export function isUnspaced(script: ScriptId): boolean {
  return UNSPACED.has(script);
}

export interface LanguageInfo {
  /** ISO 639-1 code used by the speech providers */
  id: string;
  label: string;
  /** the language's own name, for the voice picker */
  native: string;
  /** the script this language is normally written in */
  script: ScriptId;
  /** true for the languages this build normalises numerically (en/hi/te) */
  numberWords: boolean;
}

/**
 * Languages offered in the picker. Every one of these is a language the
 * configured synthesizer's own model list reports — the picker is filtered
 * again at runtime against the live model table, so an entry here never
 * promises a voice that cannot be produced.
 */
export const LANGUAGES: LanguageInfo[] = [
  { id: "en", label: "English", native: "English", script: "latin", numberWords: true },
  { id: "te", label: "Telugu", native: "తెలుగు", script: "telugu", numberWords: true },
  { id: "hi", label: "Hindi", native: "हिन्दी", script: "devanagari", numberWords: true },
  { id: "ta", label: "Tamil", native: "தமிழ்", script: "tamil", numberWords: false },
  { id: "kn", label: "Kannada", native: "ಕನ್ನಡ", script: "kannada", numberWords: false },
  { id: "ml", label: "Malayalam", native: "മലയാളം", script: "malayalam", numberWords: false },
  { id: "bn", label: "Bengali", native: "বাংলা", script: "bengali", numberWords: false },
  { id: "mr", label: "Marathi", native: "मराठी", script: "devanagari", numberWords: false },
  { id: "gu", label: "Gujarati", native: "ગુજરાતી", script: "gujarati", numberWords: false },
  { id: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ", script: "gurmukhi", numberWords: false },
  { id: "or", label: "Odia", native: "ଓଡ଼ିଆ", script: "oriya", numberWords: false },
  { id: "as", label: "Assamese", native: "অসমীয়া", script: "bengali", numberWords: false },
  { id: "ur", label: "Urdu", native: "اردو", script: "arabic", numberWords: false },
  { id: "ar", label: "Arabic", native: "العربية", script: "arabic", numberWords: false },
  { id: "ja", label: "Japanese", native: "日本語", script: "kana", numberWords: false },
  { id: "ko", label: "Korean", native: "한국어", script: "hangul", numberWords: false },
  { id: "zh", label: "Chinese", native: "中文", script: "han", numberWords: false },
  { id: "es", label: "Spanish", native: "Español", script: "latin", numberWords: false },
  { id: "fr", label: "French", native: "Français", script: "latin", numberWords: false },
  { id: "de", label: "German", native: "Deutsch", script: "latin", numberWords: false },
  { id: "pt", label: "Portuguese", native: "Português", script: "latin", numberWords: false },
  { id: "it", label: "Italian", native: "Italiano", script: "latin", numberWords: false },
  { id: "ru", label: "Russian", native: "Русский", script: "cyrillic", numberWords: false },
  { id: "id", label: "Indonesian", native: "Bahasa Indonesia", script: "latin", numberWords: false },
  { id: "tr", label: "Turkish", native: "Türkçe", script: "latin", numberWords: false },
  { id: "vi", label: "Vietnamese", native: "Tiếng Việt", script: "latin", numberWords: false },
  { id: "th", label: "Thai", native: "ไทย", script: "thai", numberWords: false },
  { id: "nl", label: "Dutch", native: "Nederlands", script: "latin", numberWords: false },
  { id: "pl", label: "Polish", native: "Polski", script: "latin", numberWords: false },
  { id: "sv", label: "Swedish", native: "Svenska", script: "latin", numberWords: false },
  { id: "fil", label: "Filipino", native: "Filipino", script: "latin", numberWords: false },
];

const BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]));

export function languageInfo(id: string): LanguageInfo | undefined {
  return BY_ID.get(id.split("-")[0]!.toLowerCase());
}

export function languageLabel(id: string): string {
  return languageInfo(id)?.label ?? id.toUpperCase();
}

/** Script → the language it most likely implies. */
const SCRIPT_LANGUAGE: Partial<Record<ScriptId, string>> = {
  telugu: "te",
  devanagari: "hi",
  bengali: "bn",
  tamil: "ta",
  kannada: "kn",
  malayalam: "ml",
  gujarati: "gu",
  gurmukhi: "pa",
  oriya: "or",
  arabic: "ar",
  hebrew: "he",
  thai: "th",
  cyrillic: "ru",
  hangul: "ko",
  kana: "ja",
  han: "zh",
  latin: "en",
};

/**
 * Romanised Telugu markers.
 *
 * These are function words and verb endings with no common English meaning, so
 * matching one is evidence of Telugu written in Latin script. Content words
 * that collide with English ("file", "code") are deliberately absent.
 */
const ROMAN_TELUGU = new Map<string, string>([
  ["nenu", "నేను"],
  ["nuvvu", "నువ్వు"],
  ["meeru", "మీరు"],
  ["miru", "మీరు"],
  ["memu", "మేము"],
  ["manam", "మనం"],
  ["vaaru", "వారు"],
  ["atanu", "అతను"],
  ["ame", "ఆమె"],
  ["adi", "అది"],
  ["idi", "ఇది"],
  ["ivi", "ఇవి"],
  ["avi", "అవి"],
  ["ippudu", "ఇప్పుడు"],
  ["appudu", "అప్పుడు"],
  ["eppudu", "ఎప్పుడు"],
  ["akkada", "అక్కడ"],
  ["ikkada", "ఇక్కడ"],
  ["ekkada", "ఎక్కడ"],
  ["ela", "ఎలా"],
  ["elaa", "ఎలా"],
  ["enduku", "ఎందుకు"],
  ["enti", "ఏంటి"],
  ["emiti", "ఏమిటి"],
  ["emi", "ఏమి"],
  ["em", "ఏం"],
  ["chey", "చెయ్"],
  ["cheyandi", "చేయండి"],
  ["cheyyandi", "చేయండి"],
  ["chesanu", "చేశాను"],
  ["chesaru", "చేశారు"],
  ["chesthunna", "చేస్తున్నా"],
  ["chestunna", "చేస్తున్నా"],
  ["chestunnaru", "చేస్తున్నారు"],
  ["chestunnam", "చేస్తున్నాం"],
  ["chestha", "చేస్తా"],
  ["chestham", "చేస్తాం"],
  ["cheyyali", "చేయాలి"],
  ["chesi", "చేసి"],
  ["chesindi", "చేసింది"],
  ["avuthundi", "అవుతుంది"],
  ["avutundi", "అవుతుంది"],
  ["avuthunna", "అవుతున్నా"],
  ["ayindi", "అయింది"],
  ["ayipoyindi", "అయిపోయింది"],
  ["undi", "ఉంది"],
  ["unnaru", "ఉన్నారు"],
  ["unna", "ఉన్న"],
  ["unnam", "ఉన్నాం"],
  ["ledu", "లేదు"],
  ["ledhu", "లేదు"],
  ["kavali", "కావాలి"],
  ["kaavali", "కావాలి"],
  ["vaddu", "వద్దు"],
  ["vadhu", "వద్దు"],
  ["kaadu", "కాదు"],
  ["kadu", "కాదు"],
  ["telusu", "తెలుసు"],
  ["teliyadu", "తెలియదు"],
  ["artham", "అర్థం"],
  ["ardham", "అర్థం"],
  ["matladu", "మాట్లాడు"],
  ["matladandi", "మాట్లాడండి"],
  ["chudu", "చూడు"],
  ["chudandi", "చూడండి"],
  ["chusukuntunna", "చూసుకుంటున్నా"],
  ["chusukondi", "చూసుకోండి"],
  ["vinu", "విను"],
  ["vinandi", "వినండి"],
  ["cheppu", "చెప్పు"],
  ["cheppandi", "చెప్పండి"],
  ["cheppanu", "చెప్పాను"],
  ["cheppindi", "చెప్పింది"],
  ["chala", "చాలా"],
  ["chaala", "చాలా"],
  ["konchem", "కొంచెం"],
  ["koncham", "కొంచెం"],
  ["baga", "బాగా"],
  ["bagundi", "బాగుంది"],
  ["bagunna", "బాగున్నా"],
  ["manchi", "మంచి"],
  ["chedu", "చెడు"],
  ["pedda", "పెద్ద"],
  ["chinna", "చిన్న"],
  ["kotha", "కొత్త"],
  ["patha", "పాత"],
  ["modati", "మొదటి"],
  ["rendu", "రెండు"],
  ["moodu", "మూడు"],
  ["nalugu", "నాలుగు"],
  ["aidu", "ఐదు"],
  ["aaru", "ఆరు"],
  ["edu", "ఏడు"],
  ["enimidi", "ఎనిమిది"],
  ["tommidi", "తొమ్మిది"],
  ["padi", "పది"],
  ["nela", "నెల"],
  ["nelu", "నెల"],
  ["roju", "రోజు"],
  ["samvatsaram", "సంవత్సరం"],
  ["ippati", "ఇప్పటి"],
  ["varaku", "వరకు"],
  ["taruvata", "తరువాత"],
  ["taruvatha", "తరువాత"],
  ["mundu", "ముందు"],
  ["venaka", "వెనక"],
  ["pakkana", "పక్కన"],
  ["gurinchi", "గురించి"],
  ["kosam", "కోసం"],
  ["valla", "వల్ల"],
  ["kani", "కానీ"],
  ["kaani", "కానీ"],
  ["mariyu", "మరియు"],
  ["ledha", "లేదా"],
  ["leda", "లేదా"],
  ["aithe", "ఐతే"],
  ["ayithe", "అయితే"],
  ["ante", "అంటే"],
  ["antaru", "అంటారు"],
  ["anukunta", "అనుకుంటా"],
  ["anukuntunna", "అనుకుంటున్నా"],
  ["pani", "పని"],
  ["panulu", "పనులు"],
  ["paristhiti", "పరిస్థితి"],
  ["ra", "రా"],
  ["randi", "రండి"],
  ["vellu", "వెళ్ళు"],
  ["vellandi", "వెళ్ళండి"],
  ["teesuko", "తీసుకో"],
  ["teesukondi", "తీసుకోండి"],
  ["pettu", "పెట్టు"],
  ["pettandi", "పెట్టండి"],
  ["pettanu", "పెట్టాను"],
  ["istunna", "ఇస్తున్నా"],
  ["istaanu", "ఇస్తాను"],
  ["nachindi", "నచ్చింది"],
  ["nachuthundi", "నచ్చుతుంది"],
  ["garu", "గారు"],
  ["andi", "అండి"],
  ["kuda", "కూడా"],
  ["chalaa", "చాలా"],
  ["ekkuva", "ఎక్కువ"],
  ["takkuva", "తక్కువ"],
  ["modalu", "మొదలు"],
  ["mugimpu", "ముగింపు"],
  ["sari", "సరి"],
  ["sare", "సరే"],
  ["ok", "ఓకే"],
  ["moonu", "మూడు"],
  ["unnayi", "ఉన్నాయి"],
  ["unnadi", "ఉన్నది"],
  ["unnadu", "ఉన్నాడు"],
  ["naku", "నాకు"],
  ["naaku", "నాకు"],
  ["cheppina", "చెప్పిన"],
  ["vishayam", "విషయం"],
  ["arthamaindi", "అర్థమైంది"],
  ["ardhamaindi", "అర్థమైంది"],
  ["padutundi", "పడుతుంది"],
  ["matladatanu", "మాట్లాడతాను"],
  ["rastanu", "రాస్తాను"],
  ["nijama", "నిజమా"],
  ["okasari", "ఒకసారి"],
  ["istam", "ఇష్టం"],
  ["ishtam", "ఇష్టం"],
  ["entha", "ఎంత"],
  ["paata", "పాట"],
  ["samasyaki", "సమస్యకి"],
  ["ayyindi", "అయ్యింది"],
  ["ayipoyindi", "అయిపోయింది"],
  ["chudandi", "చూడండి"],
  ["vinandi", "వినండి"],
  ["chesthunnaru", "చేస్తున్నారు"],
  ["untundi", "ఉంటుంది"],
  ["untaru", "ఉంటారు"],
  ["vastundi", "వస్తుంది"],
  ["pothundi", "పోతుంది"],
  ["chesukunna", "చేసుకున్న"],
  ["chestunnav", "చేస్తున్నావ్"],
  ["emaina", "ఏమైనా"],
  ["elaundi", "ఎలా ఉంది"],
]);

/** Marathi markers, to separate मराठी from हिन्दी (same script). */
const MARATHI = /आहे|नाही|कसे|मला|तुम्ही|करू|होते|पण\b/u;

export function romanTeluguWord(token: string): string | null {
  return ROMAN_TELUGU.get(token.toLowerCase()) ?? null;
}

export function isRomanTeluguToken(token: string): boolean {
  return ROMAN_TELUGU.has(token.toLowerCase());
}

/**
 * Romanised Telugu is usually written with English orthography, so a run of
 * "nenu", "chesthunna" and "gurinchi" is Telugu even though every letter is
 * Latin. Two distinct markers is the threshold: one marker word can appear in
 * English by accident ("ela" is a name), two is a sentence pattern.
 */
export function romanTeluguMarkers(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits: string[] = [];
  for (const word of words) {
    if (ROMAN_TELUGU.has(word) && !hits.includes(word)) hits.push(word);
  }
  return hits;
}

export interface LanguageRun {
  text: string;
  language: string;
  script: ScriptId;
}

export interface LanguageDetection {
  /** best single language for the whole utterance */
  language: string;
  /** true when more than one language is genuinely present */
  mixed: boolean;
  /** share of letters in the dominant script, 0…1 */
  confidence: number;
  scripts: Partial<Record<ScriptId, number>>;
  /** whether the Latin part looks like romanised Telugu */
  romanTelugu: boolean;
  markers: string[];
  runs: LanguageRun[];
}

function scriptCounts(text: string): Partial<Record<ScriptId, number>> {
  const counts: Partial<Record<ScriptId, number>> = {};
  for (const ch of text) {
    // Combining marks count: Telugu and Devanagari carry their vowels as marks, so
    // counting only \p{L} made "నేను ఇప్పుడు HYDRO AI" look mostly Latin.
    if (!/[\p{L}\p{M}]/u.test(ch)) continue;
    const script = scriptOf(ch);
    if (script === "other") continue;
    counts[script] = (counts[script] ?? 0) + 1;
  }
  return counts;
}

/**
 * Group the text into runs of one script so a mixed sentence can be spoken by
 * the right phonology in each part. Whitespace and punctuation stay with the
 * run they follow, and very short runs are merged so the synthesizer is not
 * asked to switch language on a stray article.
 */
export function splitRuns(text: string): LanguageRun[] {
  const pieces: Array<{ text: string; script: ScriptId }> = [];
  let buffer = "";
  let current: ScriptId | null = null;

  const flush = () => {
    if (buffer.trim()) pieces.push({ text: buffer, script: current ?? "other" });
    buffer = "";
  };

  for (const ch of text) {
    const script = /\p{L}/u.test(ch) ? scriptOf(ch) : null;
    // Digits, spaces and punctuation never change the run.
    if (!script) {
      buffer += ch;
      continue;
    }
    const group: ScriptId = script === "latin" ? "latin" : script;
    if (current === null) {
      current = group;
      buffer += ch;
      continue;
    }
    if (group === current) {
      buffer += ch;
      continue;
    }
    flush();
    current = group;
    buffer = ch;
  }
  flush();

  // Merge a 1–2 letter run into its neighbour: "a" or "AI" is not a language
  // switch worth a pause.
  const merged: Array<{ text: string; script: ScriptId }> = [];
  for (const piece of pieces) {
    const letters = (piece.text.match(/\p{L}/gu) ?? []).length;
    const previous = merged[merged.length - 1];
    if (previous && letters <= 2) {
      previous.text += piece.text;
      continue;
    }
    merged.push({ ...piece });
  }

  // Latin script can hold two languages at once: romanised Telugu and English.
  // Split those runs at sentence boundaries so each sentence is numbered and
  // pronounced in its own language, which is the code-switching case the app
  // exists to serve.
  const sentenceSplit: Array<{ text: string; script: ScriptId }> = [];
  for (const piece of merged) {
    if (piece.script !== "latin") {
      sentenceSplit.push(piece);
      continue;
    }
    const sentences = piece.text.split(/(?<=[.!?…])\s+/).filter((part) => part.trim());
    if (sentences.length <= 1) {
      sentenceSplit.push(piece);
      continue;
    }
    for (const sentence of sentences) {
      const previous = sentenceSplit[sentenceSplit.length - 1];
      const isTelugu = romanTeluguMarkers(sentence).length >= 2;
      if (previous && previous.script === "latin") {
        const previousIsTelugu = romanTeluguMarkers(previous.text).length >= 2;
        if (previousIsTelugu === isTelugu) {
          previous.text = `${previous.text} ${sentence}`;
          continue;
        }
      }
      sentenceSplit.push({ text: sentence, script: piece.script });
    }
  }

  return sentenceSplit.map((piece) => ({
    text: piece.text.trim(),
    script: piece.script,
    language:
      piece.script === "latin"
        ? romanTeluguMarkers(piece.text).length >= 2
          ? "te"
          : "en"
        : (SCRIPT_LANGUAGE[piece.script] ?? "en"),
  }));
}

/**
 * Detect the language of an utterance, preferring an explicit override.
 * `preferred` is what the user picked; "auto" means decide from the text.
 */
export function detectLanguage(text: string, preferred = "auto"): LanguageDetection {
  const counts = scriptCounts(text);
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  const markers = romanTeluguMarkers(text);
  const runs = splitRuns(text);

  let dominant: ScriptId = "latin";
  let best = 0;
  for (const [script, count] of Object.entries(counts) as Array<[ScriptId, number]>) {
    if (count > best) {
      best = count;
      dominant = script;
    }
  }

  const latinCount = counts.latin ?? 0;
  const romanTelugu =
    dominant === "latin" ? markers.length >= 2 : markers.length >= 2 && latinCount > 6;

  // English words inside an Indian-language sentence are normal; an Indian
  // script inside an English sentence is not. So when Latin is the largest
  // script but a native script is present in a substantial share, the native
  // script is the language: "మీరు React use చేస్తున్నారా" is Telugu.
  let effective: ScriptId = dominant;
  if (dominant === "latin" && latinCount > 0) {
    let nativeScript: ScriptId | null = null;
    let nativeCount = 0;
    for (const [script, count] of Object.entries(counts) as Array<[ScriptId, number]>) {
      if (script === "latin") continue;
      if (count > nativeCount) {
        nativeCount = count;
        nativeScript = script;
      }
    }
    // Short grants on the Latin side are common ("Please … చదవండి"), so the
    // native script wins whenever it has real words and Latin is not dominant
    // by a wide margin.
    if (nativeScript && nativeCount >= 4 && latinCount < nativeCount * 3.2) {
      effective = nativeScript;
    }
  }

  const detected =
    effective === "latin"
      ? romanTelugu
        ? "te"
        : "en"
      : effective === "devanagari" && MARATHI.test(text)
        ? "mr"
        : (SCRIPT_LANGUAGE[effective] ?? "en");

  const override = preferred && preferred !== "auto" ? preferred : null;
  const language = override ?? detected;

  const nonDominant = total - best;
  // Mixed means a second script carries at least 12% of the letters, or the
  // Latin half of a Telugu sentence is a real phrase rather than a product name.
  const mixed =
    (total > 0 && nonDominant / total >= 0.12) ||
    (dominant !== "latin" && latinCount >= 12) ||
    (dominant === "latin" && markers.length >= 2 && latinCount >= 12);

  return {
    language,
    mixed,
    confidence: total ? best / total : 0,
    scripts: counts,
    romanTelugu,
    markers,
    runs,
  };
}

/** BCP-47 tag for the browser's own synthesizer (a real fallback engine). */
export function bcp47(language: string): string {
  const map: Record<string, string> = {
    en: "en-IN",
    te: "te-IN",
    hi: "hi-IN",
    ta: "ta-IN",
    kn: "kn-IN",
    ml: "ml-IN",
    bn: "bn-IN",
    mr: "mr-IN",
    gu: "gu-IN",
    pa: "pa-IN",
    ur: "ur-IN",
    ar: "ar-SA",
    ja: "ja-JP",
    ko: "ko-KR",
    zh: "zh-CN",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    pt: "pt-BR",
    it: "it-IT",
    ru: "ru-RU",
    id: "id-ID",
    tr: "tr-TR",
    vi: "vi-VN",
    th: "th-TH",
    nl: "nl-NL",
    pl: "pl-PL",
    sv: "sv-SE",
    fil: "fil-PH",
  };
  return map[language] ?? language;
}
