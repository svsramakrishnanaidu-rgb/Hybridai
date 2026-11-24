/**
 * HYDRO AI — pronunciation preprocessing.
 *
 * Three things make synthesized speech sound wrong even with a good voice:
 *
 *   1. Romanised Telugu. "Nenu ippudu chesthunna" written in Latin letters is
 *      read with English phonetics by every Western TTS model — "nenu" becomes
 *      "nee-noo". Converting those tokens to Telugu script is what makes mixed
 *      speech sound Telugu-English instead of English nonsense.
 *   2. Technical vocabulary. "useState", "n8n", "C++", ".tsx", "k8s", "API" are
 *      read as words or skipped entirely unless they are expanded.
 *   3. The user's own names and places, which no general model can guess.
 *
 * Everything here is deterministic and returns both the rewritten text and a
 * list of what changed, so the settings panel can show real evidence rather
 * than claiming "AI pronunciation".
 */

import { romanTeluguWord } from "./languages.ts";

export interface PronunciationRule {
  id: string;
  /** the word or phrase to match, case-insensitive */
  word: string;
  /** what the synthesizer should read instead */
  say: string;
  /** restrict to one language; "any" applies everywhere */
  language: string;
  enabled: boolean;
  createdAt: string;
}

export interface PronunciationResult {
  text: string;
  notes: string[];
  /** which rules and rewrites fired, for the inspector */
  applied: string[];
}

/* ─────────────────────── Romanised Telugu → తెలుగు script ───────────────── */

/**
 * Suffixes that can follow a Telugu stem in romanised writing. Longest first,
 * so "gurinchi" wins over "chi". The suffix is kept in script form, which is
 * what keeps the word grammatical instead of a bare stem.
 */
/**
 * `attach` is false for postpositions and participles, which are separate words
 * in Telugu: "పని గురించి", not "పనిగురించి". Case endings attach.
 */
const SUFFIXES: Array<[string, string, boolean]> = [
  ["gurinchi", "గురించి", false],
  ["nunchi", "నుంచి", false],
  ["kosam", "కోసం", false],
  ["valla", "వల్ల", false],
  ["thunnaru", "తున్నారు", true],
  ["thunnam", "తున్నాం", true],
  ["thunna", "తున్నా", true],
  ["chesi", "చేసి", true],
  ["lu", "లు", true],
  ["ki", "కి", true],
  ["ku", "కు", true],
  ["ni", "ని", true],
  ["nu", "ను", true],
  ["lo", "లో", true],
  ["tho", "తో", true],
  ["gā", "గా", true],
  ["ga", "గా", true],
  ["lā", "లా", true],
];

/** Telugu stems that commonly take a suffix, with their script form. */
const STEMS: Record<string, string> = {
  pustaka: "పుస్తక",
  pustakam: "పుస్తకం",
  panulu: "పనులు",
  pani: "పని",
  illu: "ఇల్లు",
  inti: "ఇంటి",
  manushula: "మనుషుల",
  bhasha: "భాష",
  basha: "భాష",
  padam: "పదం",
  artham: "అర్థం",
  ardham: "అర్థం",
  prashna: "ప్రశ్న",
  jawabu: "జవాబు",
  javabu: "జవాబు",
  samasya: "సమస్య",
  vidhanam: "విధానం",
  sangatulu: "సంగతులు",
  katha: "కథ",
  kodi: "కోడి",
  uddesham: "ఉద్దేశం",
  korika: "కోరిక",
  prayatnam: "ప్రయత్నం",
  phalitam: "ఫలితం",
  nijam: "నిజం",
  abhiprayam: "అభిప్రాయం",
  anubhavam: "అనుభవం",
  jeevitham: "జీవితం",
  samayam: "సమయం",
  sthanam: "స్థానం",
  karyakramam: "కార్యక్రమం",
  bhavana: "భావన",
  vishayam: "విషయం",
  baikalu: "బైకులు",
  cinema: "సినిమా",
  paata: "పాట",
  padya: "పద్య",
  kavita: "కవిత",
  dhanyavadalu: "ధన్యవాదాలు",
  namaskaram: "నమస్కారం",
  swagatam: "స్వాగతం",
  sambandham: "సంబంధం",
  vyaktigatam: "వ్యక్తిగతం",
  samajam: "సమాజం",
  desham: "దేశం",
  nagaram: "నగరం",
  panduga: "పండుగ",
  tirupati: "తిరుపతి",
  hyderabad: "హైదరాబాద్",
  vijayawada: "విజయవాడ",
  vizag: "విశాఖ",
  amaravati: "అమరావతి",
  guntur: "గుంటూరు",
  warangal: "వరంగల్",
  tirumala: "తిరుమల",
};

/** Words that must never be transliterated, even if a stem+ suffix fits. */
const PROTECTED = new Set([
  "hydro", "ai", "api", "code", "file", "app", "data", "model", "server", "client",
  "react", "python", "java", "node", "next", "html", "css", "json", "sql", "git",
  "google", "apple", "microsoft", "windows", "linux", "chrome", "email", "online",
  "update", "download", "install", "login", "logout", "settings", "system",
]);

/**
 * Convert one romanised Telugu token to Telugu script, or return null when the
 * token is not confidently Telugu. Confidence comes from the curated lexicon
 * first, then from an unambiguous stem + grammatical suffix combination.
 */
export function transliterateRomanTelugu(token: string): string | null {
  const lower = token.toLowerCase().replace(/[^a-zāīūēō]/g, "");
  if (!lower || lower.length < 2) return null;
  if (PROTECTED.has(lower)) return null;

  const direct = romanTeluguWord(lower);
  if (direct) return direct;

  for (const [suffix, scriptSuffix, attach] of SUFFIXES) {
    if (!lower.endsWith(suffix)) continue;
    const stem = lower.slice(0, lower.length - suffix.length);
    if (stem.length < 3) continue;
    const joiner = attach ? "" : " ";
    const stemScript = STEMS[stem];
    if (stemScript) return `${stemScript}${joiner}${scriptSuffix}`;
    const derived = romanTeluguWord(stem);
    if (derived) return `${derived}${joiner}${scriptSuffix}`;
  }
  return null;
}

/* ───────────────────────── technical vocabulary ────────────────────────── */

/**
 * Terms whose written form is read wrongly. The replacement keeps the term
 * recognisable while giving the synthesizer something it can pronounce.
 * Code identifiers are handled separately by `expandIdentifier`.
 */
const LEXICON: Record<string, string> = {
  "c++": "C plus plus",
  "c#": "C sharp",
  ".net": "dot net",
  "f#": "F sharp",
  "node.js": "node jay ess",
  "next.js": "next jay ess",
  "vue.js": "view jay ess",
  "n8n": "n eight n",
  "k8s": "kates",
  "k8": "kates",
  "gRPC": "gee are pee see",
  "kubectl": "cube control",
  "nginx": "engine x",
  "sql": "sequel",
  "sse": "ess ess ee",
  "jwt": "jay double you tee",
  "oauth": "oh auth",
  "uuid": "you you eye dee",
  "ui": "you eye",
  "ux": "you ex",
  "cli": "see ell eye",
  "sdk": "ess dee kay",
  "ide": "eye dee ee",
  "pdf": "pee dee eff",
  "csv": "see ess vee",
  "png": "pee en gee",
  "jpeg": "jay peg",
  "gif": "gif",
  "sqlite": "sequel lite",
  "postgres": "post gress",
  "typescript": "type script",
  "javascript": "java script",
  "github": "git hub",
  "npm": "en pee em",
  "ssh": "ess ess aitch",
  "cpu": "see pee you",
  "gpu": "gee pee you",
  "ram": "ram",
  "ssd": "ess ess dee",
  "os": "oh ess",
  "iot": "eye oh tee",
  "llm": "ell ell em",
  "tts": "tee tee ess",
  "stt": "ess tee tee",
  "html": "aitch tee em ell",
  "css": "see ess ess",
  "yaml": "yam el",
  "toml": "tom el",
  "regex": "redge ex",
  "async": "a sink",
  "await": "a wait",
  "enum": "ee num",
  "boolean": "bool ee an",
  "char": "kar",
  "sudo": "soo doo",
  "bash": "bash",
  "shell": "shell",
  "height": "hite",
  "width": "width",
  "queue": "kyoo",
  "cache": "cash",
  "cookie": "cooky",
  "route": "root",
  "router": "rooter",
  "schema": "skee ma",
  "tuple": "tupple",
  "null": "null",
  "nil": "nil",
  "stdout": "standard out",
  "stdin": "standard in",
  "env": "env",
  "config": "config",
  "auth": "auth",
  "repo": "reppo",
  "vs": "versus",
  "etc": "et cetera",
  "approx": "approximately",
  "e.g": "for example",
  "i.e": "that is",
  "w.r.t": "with respect to",
  "→": "to",
  "←": "from",
  "→\uFE0F": "to",
  "±": "plus or minus",
  "×": "times",
  "÷": "divided by",
  "°": " degrees",
  "&": " and ",
  "@": " at ",
  "#": " number ",
  "+": " plus ",
};

/** Split identifiers the way they are spoken: camelCase, snake_case, kebab. */
export function expandIdentifier(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_.](?=[a-zA-Z])/g, " ")
    .replace(/\(\)$/, " function")
    .replace(/\s+/g, " ")
    .trim();
}

/* ───────────────────────────── the pipeline ───────────────────────────── */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite text for pronunciation.
 *
 * Order matters: the user's own rules win over the built-in lexicon, and the
 * Telugu transliteration happens before identifier expansion so a Telugu word
 * is not split as if it were camelCase.
 */
export function applyPronunciation(
  text: string,
  language: string,
  rules: PronunciationRule[] = [],
): PronunciationResult {
  const lang = language.split("-")[0]!;
  const notes: string[] = [];
  const applied: string[] = [];
  let out = text;

  // 1. User rules — whole word, longest phrase first.
  const active = rules
    .filter((rule) => rule.enabled && (rule.language === "any" || rule.language === lang))
    .sort((a, b) => b.word.length - a.word.length);
  for (const rule of active) {
    const word = rule.word.trim();
    if (!word) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "giu");
    if (!pattern.test(out)) continue;
    out = out.replace(pattern, rule.say);
    applied.push(`${word} → ${rule.say}`);
  }
  if (applied.length) notes.push(`custom pronunciation (${applied.length})`);

  // 2. Romanised Telugu → native script. This is the mixed-speech fix.
  let transliterated = 0;
  if (lang === "te" || lang === "mixed") {
    out = out.replace(/[A-Za-zāīūēō]{2,}/g, (token) => {
      // Keep URLs, paths and identifiers in Latin.
      if (/[._/@]|\d/.test(token)) return token;
      const script = transliterateRomanTelugu(token);
      if (!script) return token;
      transliterated += 1;
      return script;
    });
    if (transliterated) notes.push(`romanised Telugu → తెలుగు (${transliterated} words)`);
  }

  // 3. Built-in technical lexicon, case-insensitive, longest first.
  const terms = Object.keys(LEXICON).sort((a, b) => b.length - a.length);
  let lexiconHits = 0;
  for (const term of terms) {
    const replacement = LEXICON[term]!;
    const boundaryStart = /^[\w.#+]/i.test(term) ? "(?<![\\p{L}\\p{N}])" : "";
    const boundaryEnd = /[\w.#+]$/i.test(term) ? "(?![\\p{L}\\p{N}])" : "";
    const pattern = new RegExp(`${boundaryStart}${escapeRegExp(term)}${boundaryEnd}`, "giu");
    if (!pattern.test(out)) continue;
    out = out.replace(pattern, replacement);
    lexiconHits += 1;
  }
  if (lexiconHits) notes.push(`technical terms expanded (${lexiconHits})`);

  // 4. camelCase / snake_case identifiers that survived.
  let identifiers = 0;
  out = out.replace(/\b[a-z]+(?:[A-Z][a-z]+)+\b|\b[a-z]+_[a-z_]+\b|\b[a-z]+\(\)/g, (token) => {
    if (token.length < 4) return token;
    identifiers += 1;
    return expandIdentifier(token);
  });
  if (identifiers) notes.push(`identifiers split (${identifiers})`);

  // 5. Collapse the spaces the replacements introduced.
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();

  return { text: out, notes, applied };
}

/**
 * A pronunciation rule from untrusted input.
 * Returns null when the rule cannot be applied safely (empty, too long, or a
 * replacement that would be read as markup).
 */
export function sanitizeRule(input: unknown): PronunciationRule | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const word = typeof raw.word === "string" ? raw.word.trim().slice(0, 60) : "";
  const say = typeof raw.say === "string" ? raw.say.trim().slice(0, 160) : "";
  if (!word || !say) return null;
  if (/[<>{}]/.test(word) || /[<>{}]/.test(say)) return null;
  const language = typeof raw.language === "string" ? raw.language.slice(0, 8) : "any";
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 40) : `pr_${Date.now().toString(36)}`,
    word,
    say,
    language: language === "any" ? "any" : language.split("-")[0]!,
    enabled: raw.enabled !== false,
    createdAt:
      typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}
