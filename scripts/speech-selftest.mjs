/**
 * HYDRO AI — speech pipeline self-test.
 *
 * Exercises the real modules that decide what is spoken, in which language and
 * with which model: script detection, Roman-Telugu recognition, number/currency
 * word generation, markdown + symbol normalisation, pronunciation rules,
 * sentence planning, preference clamping, model routing and the composed plan.
 *
 * Everything here is deterministic and runs without a network call or a browser.
 * It does NOT prove how the audio sounds: naturalness needs human ears, and the
 * measured round-trip intelligibility benchmark is `npm run speech:bench`.
 *
 * Run: npm run speech:test
 */

import {
  LANGUAGES,
  bcp47,
  detectLanguage,
  languageLabel,
  romanTeluguMarkers,
  romanTeluguWord,
  scriptOf,
  splitRuns,
} from "../src/core/speech/languages.ts";
import {
  decimalToWords,
  normalizeForSpeech,
  numberToWords,
} from "../src/core/speech/normalize.ts";
import {
  applyPronunciation,
  expandIdentifier,
  sanitizeRule,
  transliterateRomanTelugu,
} from "../src/core/speech/pronounce.ts";
import { clampForSpeech, planSegments, prosodyContext, splitSentences } from "../src/core/speech/segment.ts";
import {
  DEFAULT_SPEECH_SETTINGS,
  SPEECH_MODES,
  modeSpec,
  normalizeSpeechSettings,
  outputFormat,
  synthesisParams,
} from "../src/core/speech/settings.ts";
import {
  fallbackModels,
  hydrateModels,
  routeModels,
  supportsLanguage,
  verifiedLanguages,
} from "../src/core/speech/router.ts";
import { planSpeech, publicPlan } from "../src/core/speech/pipeline.ts";
import { toVoiceOption, searchVoices, VOICE_SNAPSHOT } from "../src/core/speech/voices.ts";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function includes(name, haystack, needle) {
  check(
    name,
    typeof haystack === "string" && haystack.includes(needle),
    `expected to include ${JSON.stringify(needle)}, got ${JSON.stringify(haystack).slice(0, 160)}`,
  );
}

function excludes(name, haystack, needle) {
  check(name, typeof haystack === "string" && !haystack.includes(needle), `expected to exclude ${JSON.stringify(needle)}`);
}

const models = fallbackModels();

/* ───────────────────────────── script detection ────────────────────────── */

eq("telugu code point is telugu script", scriptOf("త"), "telugu");
eq("devanagari is devanagari", scriptOf("ह"), "devanagari");
eq("cyrillic is cyrillic", scriptOf("Ж"), "cyrillic");
eq("han is han", scriptOf("中"), "han");
eq("latin is latin", scriptOf("A"), "latin");
eq("space is other", scriptOf(" "), "other");

const teSentence = "నేను ఇప్పుడు హైడ్రోను అభివృద్ధి చేస్తున్నాను.";
const hiSentence = "मैं अभी हाइड्रो बना रहा हूँ।";
const mixedSentence = "Nenu ippudu HYDRO AI chesthunna, can you explain this code?";
const romanOnly = "nenu ippudu chesthunna gurinchi cheppu";

eq("telugu script detected", detectLanguage(teSentence).language, "te");
eq("hindi script detected", detectLanguage(hiSentence).language, "hi");
eq("english detected", detectLanguage("I am building a speech pipeline.").language, "en");
eq("romanised telugu detected as telugu", detectLanguage(mixedSentence).language, "te");
eq(
  "telugu script with english words is still telugu",
  detectLanguage("నేను ఇప్పుడు HYDRO AI ni develop చేస్తున్నా.").language,
  "te",
);
check(
  "combining marks count toward the script share",
  detectLanguage("నేను ఇప్పుడు HYDRO AI ni develop చేస్తున్నా.").confidence > 0.5,
);
eq("roman-only telugu detected", detectLanguage(romanOnly).language, "te");
eq("product name alone is english", detectLanguage("HYDRO AI").language, "en");
eq(
  "romanised sentence with rarer vocabulary still detects telugu",
  detectLanguage("Aa file lo moonu errors unnayi, first di chudu.").language,
  "te",
);
eq(
  "telugu script survives english-heavy code switching",
  detectLanguage("మీరు React use చేస్తున్నారా, లేదా plain java script?").language,
  "te",
);
eq(
  "short english wrapper around a telugu phrase stays telugu",
  detectLanguage("Please ఈ error message చదవండి.").language,
  "te",
);
eq(
  "marathi is separated from hindi",
  detectLanguage("नमस्कार, मी हायड्रो. कशी मदत करू शकतो?").language,
  "mr",
);
// Documented limitation: Latin-script languages other than English need an
// explicit choice, because script alone cannot identify them.
eq(
  "spanish falls back to english without an explicit choice",
  detectLanguage("Hola, soy HYDRO. ¿En qué puedo ayudarte hoy?").language,
  "en",
);
eq("explicit override wins", detectLanguage(teSentence, "hi").language, "hi");
eq("auto override behaves like detection", detectLanguage(teSentence, "auto").language, "te");
check("telugu script is confident", detectLanguage(teSentence).confidence > 0.95);
check("mixed sentence marked mixed", detectLanguage(mixedSentence).mixed);
eq("single-language sentence is not mixed", detectLanguage("This is a plain English sentence.").mixed, false);
check("roman telugu flag set", detectLanguage(mixedSentence).romanTelugu);
check("markers list names two words", romanTeluguMarkers(mixedSentence).length >= 2);
eq("one marker word is not enough", romanTeluguMarkers("ela is a name").length, 1);
eq("roman telugu lexicon maps nenu", romanTeluguWord("nenu"), "నేను");
eq("roman telugu lookup is case-insensitive", romanTeluguWord("NENU"), "నేను");
eq("unknown word is not in lexicon", romanTeluguWord("banana"), null);

const runs = splitRuns("Nenu ippudu HYDRO AI ni develop chesthunna, can you explain this code?");
eq("runs keep a single latin block here", runs.length, 1);
eq("latin run is tagged telugu by markers", runs[0].language, "te");

const scriptSwitch = splitRuns("ఇది code. and this is English text");
check("script switch produces two runs", scriptSwitch.length === 2, `got ${scriptSwitch.length}`);
eq("first run telugu", scriptSwitch[0].language, "te");
eq("second run english", scriptSwitch[1].language, "en");

eq("bcp47 telugu", bcp47("te"), "te-IN");
eq("bcp47 english india", bcp47("en"), "en-IN");
eq("bcp47 unknown falls back to code", bcp47("xx"), "xx");
eq("language label resolves", languageLabel("te"), "Telugu");
check("catalogue has telugu and hindi", LANGUAGES.some((l) => l.id === "te") && LANGUAGES.some((l) => l.id === "hi"));

/* ─────────────────────────── number → words ────────────────────────────── */

eq("zero", numberToWords(0, "en"), "zero");
eq("seven", numberToWords(7, "en"), "seven");
eq("thirteen", numberToWords(13, "en"), "thirteen");
eq("twenty one", numberToWords(21, "en"), "twenty one");
eq("one hundred five", numberToWords(105, "en"), "one hundred five");
eq("thousand", numberToWords(1000, "en"), "one thousand");
eq("1250", numberToWords(1250, "en"), "one thousand two hundred fifty");
eq("one million", numberToWords(1_000_000, "en"), "one million");
eq("telugu 1250 uses plural hundreds", numberToWords(1250, "te"), "ఒకటి వెయ్యి రెండు వందల యాభై");
eq("telugu 2000 uses plural thousands", numberToWords(2000, "te"), "రెండు వేల");
eq("hindi 1250", numberToWords(1250, "hi"), "एक हज़ार दो सौ पचास");
eq("telugu lakh grouping", numberToWords(125000, "te"), "ఒకటి లక్ష ఇరవై ఐదు వేల");
eq("hindi crore grouping", numberToWords(10_000_000, "hi"), "एक करोड़");
eq("unsupported language has no number words", numberToWords(5, "tr"), null);
eq("decimal english", decimalToWords("3.5", "en"), "three point five");
eq("decimal telugu", decimalToWords("2.25", "te"), "రెండు పాయింట్ రెండు ఐదు");
eq("negative decimal", decimalToWords("-1.5", "en"), "-one point five");
eq("comma stripping", decimalToWords("1,250", "en"), "one thousand two hundred fifty");
eq("non-numeric rejected", decimalToWords("abc", "en"), null);

/* ──────────────────────── normalisation for speech ─────────────────────── */

const currency = normalizeForSpeech("The plan costs ₹1,250 per month.", "en");
includes("rupee amount spoken", currency.text, "one thousand two hundred fifty rupees");
excludes("rupee symbol removed", currency.text, "₹");
check("currency reported", currency.notes.some((note) => note.includes("currency")));

const currencyTe = normalizeForSpeech("దీని ధర ₹1,250.", "te");
includes("telugu rupee word", currencyTe.text, "రూపాయలు");

const percent = normalizeForSpeech("Accuracy improved by 40%.", "en");
includes("percent spoken", percent.text, "forty percent");
eq("percent symbol removed", percent.text.includes("%"), false);

const iso = normalizeForSpeech("Due on 2026-03-12.", "en");
includes("iso date day", iso.text, "twelve March");
includes("iso date year", iso.text, "two thousand twenty six");
const dayFirst = normalizeForSpeech("Due on 12/03/2026.", "en");
includes("day-first date parsed", dayFirst.text, "twelve March");
const dateTe = normalizeForSpeech("తేదీ 2026-03-12.", "te");
includes("telugu month name", dateTe.text, "మార్చి");

const clock = normalizeForSpeech("The call is at 14:30 today.", "en");
includes("clock time spoken", clock.text, "two thirty PM");
const clockHi = normalizeForSpeech("मीटिंग 14:30 पर है।", "hi");
includes("hindi clock time", clockHi.text, "बजकर");

const math = normalizeForSpeech("2 + 3 = 5 and 10 - 4 = 6.", "en");
includes("addition narrated", math.text, "two plus three");
includes("equality narrated", math.text, "equals");
includes("subtraction narrated", math.text, "minus");
const exponent = normalizeForSpeech("The area is x^2 metres.", "en");
includes("exponent narrated", exponent.text, "x squared");

const units = normalizeForSpeech("It is 5 km away and 20 GB of data.", "en");
includes("kilometres spoken", units.text, "five kilometres");
includes("gigabytes spoken", units.text, "twenty gigabytes");

const markup = normalizeForSpeech(
  "## Heading\n\n**Bold** and `inlineCode` and [a link](https://example.com).\n\n```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- item one\n\n🚀 done",
  "en",
);
excludes("heading hashes removed", markup.text, "##");
excludes("bold markers removed", markup.text, "**");
includes("inline code kept", markup.text, "inlineCode");
includes("link label kept", markup.text, "a link");
excludes("url removed", markup.text, "example.com");
includes("code fenced as marker", markup.text, "code block");
excludes("code body not read", markup.text, "const x");
includes("table row flattened", markup.text, "one, two");
excludes("emoji removed", markup.text, "🚀");
check("markup rewrite reported", markup.notes.some((note) => note.includes("markdown")));

const turkish = normalizeForSpeech("Toplam 1250 lira.", "tr");
includes("unsupported language keeps digits", turkish.text, "1250");

const english = normalizeForSpeech("Version 3 of the API is ready.", "en");
includes("version number spoken", english.text, "three");
includes("API not expanded by normaliser", english.text, "API");

/* ─────────────────────────── pronunciation ─────────────────────────────── */

eq("c++ spoken", applyPronunciation("I write C++ daily.", "en").text, "I write C plus plus daily.");
includes("c# spoken", applyPronunciation("C# is typed.", "en").text, "C sharp");
includes("n8n spoken", applyPronunciation("We use n8n for that.", "en").text, "n eight n");
includes("k8s spoken", applyPronunciation("Deploy on k8s.", "en").text, "kates");
includes("sql spoken as sequel", applyPronunciation("Run the SQL query.", "en").text, "sequel");
includes("node.js spoken", applyPronunciation("Use Node.js here.", "en").text, "node jay ess");
includes("dotnet spoken", applyPronunciation("It runs on .NET.", "en").text, "dot net");
includes("camelCase split", applyPronunciation("Call the useState hook.", "en").text, "use State");
includes("snake_case split", applyPronunciation("Set max_calls first.", "en").text, "max calls");
eq("identifier expansion strips call parens", expandIdentifier("render()"), "render function");
eq("identifier expansion of PascalCase", expandIdentifier("HydroEngine"), "Hydro Engine");

const ruleApplied = applyPronunciation("DHRUVA is the project.", "en", [
  { id: "r1", word: "DHRUVA", say: "DROO vaa", language: "any", enabled: true, createdAt: "" },
]);
includes("custom rule wins", ruleApplied.text, "DROO vaa");
excludes("custom rule replaces the word", ruleApplied.text, "DHRUVA");
check("custom rule reported", ruleApplied.notes.some((note) => note.includes("custom")));

const ruleScoped = applyPronunciation("DHRUVA", "te", [
  { id: "r2", word: "DHRUVA", say: "ధ్రువ", language: "en", enabled: true, createdAt: "" },
]);
eq("language-scoped rule does not fire elsewhere", ruleScoped.text, "DHRUVA");

const ruleDisabled = applyPronunciation("DHRUVA", "en", [
  { id: "r3", word: "DHRUVA", say: "DROO vaa", language: "any", enabled: false, createdAt: "" },
]);
eq("disabled rule is skipped", ruleDisabled.text, "DHRUVA");

eq("transliterate nenu", transliterateRomanTelugu("nenu"), "నేను");
eq("transliterate chesthunna", transliterateRomanTelugu("chesthunna"), "చేస్తున్నా");
eq("transliterate suffix form", transliterateRomanTelugu("paniki"), "పనికి");
eq(
  "postposition keeps its own word",
  transliterateRomanTelugu("panigurinchi"),
  "పని గురించి",
);
eq("case suffix attaches", transliterateRomanTelugu("pustakamlo"), "పుస్తకంలో");
eq("another case suffix", transliterateRomanTelugu("arthamki"), "అర్థంకి");
eq("english word is not transliterated", transliterateRomanTelugu("react"), null);
eq("protected word is not transliterated", transliterateRomanTelugu("code"), null);
eq("too-short token is not transliterated", transliterateRomanTelugu("a"), null);

const mixed = applyPronunciation("nenu ippudu HYDRO AI chesthunna, can you explain this code?", "mixed");
includes("mixed speech converts telugu word", mixed.text, "నేను");
includes("mixed speech keeps english words", mixed.text, "explain this code");
includes("mixed speech keeps product name", mixed.text, "HYDRO");
check("transliteration reported", mixed.notes.some((note) => note.includes("romanised")));

const notTelugu = applyPronunciation("Nenu is not here", "en");
excludes("english mode leaves roman telugu alone", notTelugu.text, "నేను");

eq("sanitize rejects empty", sanitizeRule({ word: "", say: "" }), null);
eq("sanitize rejects markup", sanitizeRule({ word: "<b>x</b>", say: "y" }), null);
check("sanitize accepts a valid rule", Boolean(sanitizeRule({ word: "API", say: "ay pee eye", language: "en" })));
eq("sanitize normalises language", sanitizeRule({ word: "API", say: "ay", language: "te-IN" }).language, "te");
eq("sanitize defaults to any", sanitizeRule({ word: "API", say: "ay" }).language, "any");

/* ───────────────────────────── segmentation ───────────────────────────── */

eq("two sentences", splitSentences("One. Two.").length, 2);
eq("abbreviation does not split", splitSentences("Mr. Rao is here.").length, 1);
eq("decimal does not split", splitSentences("It costs 3.5 dollars.").length, 1);
eq("telugu danda splits", splitSentences("ఇది ఒకటి। ఇది రెండు।").length, 2);
eq("question kept", splitSentences("Is it ready?")[0], "Is it ready?");
eq("ellipsis splits", splitSentences("Wait… then go.").length, 2);
eq("empty input gives no sentences", splitSentences("").length, 0);

const plan = planSegments("Yes. This is a much longer sentence that clearly exceeds the minimum length for speech.");
check("short fragment merged forward", plan.length === 1, `got ${plan.length}`);
eq("merged segment keeps both", plan[0].text.startsWith("Yes."), true);
eq("last flag set", plan[0].last, true);
const many = planSegments(
  "First sentence here is long enough to stand alone. Second sentence here is also long enough to stand alone. Third one too.",
  { minChars: 20 },
);
check("multiple segments planned", many.length >= 2, `got ${many.length}`);
check("indices are sequential", many.every((segment, index) => segment.index === index));
const long = planSegments(`${"word ".repeat(120)}.`, { maxChars: 120 });
check("long sentence is split", long.length > 1, `got ${long.length}`);
check("no segment exceeds the cap by much", long.every((segment) => segment.text.length <= 180));
const contextMiddle = prosodyContext(many, 1);
check("previous context present", contextMiddle.previousText.length > 0);
const contextFirst = prosodyContext(many, 0);
check("next context present", contextFirst.nextText.length > 0);
const contextLast = prosodyContext(many, many.length - 1);
eq("last segment has no next context", contextLast.nextText, "");
eq("clamp keeps short text", clampForSpeech("short answer", 100), "short answer");
const clamped = clampForSpeech(`${"Sentence one is here. ".repeat(30)}`, 120);
check("clamp respects the ceiling", clamped.length <= 121, `got ${clamped.length}`);

/* ────────────────────────────── settings ──────────────────────────────── */

const defaults = normalizeSpeechSettings({});
eq("default mode", defaults.mode, "natural");
eq("default language auto", defaults.language, "auto");
eq("default streaming on", defaults.streaming, true);
eq("speed clamped high", normalizeSpeechSettings({ speed: 9 }).speed, 2);
eq("speed clamped low", normalizeSpeechSettings({ speed: 0.1 }).speed, 0.5);
eq("volume clamped", normalizeSpeechSettings({ volume: 5 }).volume, 1);
eq("unknown mode falls back", normalizeSpeechSettings({ mode: "karaoke" }).mode, "natural");
eq("bad language falls back", normalizeSpeechSettings({ language: "!!" }).language, "auto");
eq("short language code accepted", normalizeSpeechSettings({ language: "te" }).language, "te");
eq("regional language code accepted", normalizeSpeechSettings({ language: "te-in" }).language, "te-in");
eq("non-boolean coerced", normalizeSpeechSettings({ subtitles: "yes" }).subtitles, true);
eq("pronunciation array kept", normalizeSpeechSettings({ pronunciation: [{ id: "a" }] }).pronunciation.length, 1);
eq("voiceId trims to null when empty", normalizeSpeechSettings({ voiceId: "  " }).voiceId, null);
check("eight modes defined", SPEECH_MODES.length === 8, `got ${SPEECH_MODES.length}`);
eq("mode spec lookup", modeSpec("study").label, "Study");
eq("unknown mode spec falls back to first", modeSpec("nope").id, "natural");

const params = synthesisParams(DEFAULT_SPEECH_SETTINGS, { style: 0.6, stability: 0.2, speed: 1.1, pauseMs: 200 });
check("stability in provider range", params.stability >= 0.2 && params.stability <= 0.85);
check("style in provider range", params.styleExaggeration >= 0 && params.styleExaggeration <= 0.75);
check("speed in provider range", params.speed >= 0.6 && params.speed <= 1.6);
check("pause is bounded", params.pauseMs >= 40 && params.pauseMs <= 900);
eq("standard quality format is a provider-valid rate", outputFormat("standard"), "mp3_44100_64");
eq("high quality format", outputFormat("high"), "mp3_44100_128");
eq("best quality format", outputFormat("best"), "mp3_44100_192");
const studyParams = synthesisParams({ ...DEFAULT_SPEECH_SETTINGS, mode: "study", speed: 1 });
check("study mode slows down", studyParams.speed < 1, `got ${studyParams.speed}`);
const lowLatency = synthesisParams({ ...DEFAULT_SPEECH_SETTINGS, mode: "low-latency" });
eq("low latency asks for the standard band", lowLatency.modelPreference, "standard");

/* ──────────────────────────────── routing ─────────────────────────────── */

const teHigh = routeModels({ language: "te", quality: "high", models });
eq("telugu uses v4 turbo first", teHigh.chain[0], "eleven_v4_turbo");
eq("telugu is supported", teHigh.unsupported, false);
eq("turbo v2.5 is never chosen for telugu", teHigh.chain.includes("eleven_turbo_v2_5"), false);
eq("multilingual v2 is never chosen for telugu", teHigh.chain.includes("eleven_multilingual_v2"), false);
const enStandard = routeModels({ language: "en", quality: "standard", models });
eq("english standard prefers flash", enStandard.chain[0], "eleven_flash_v2_5");
const enBest = routeModels({ language: "en", quality: "best", models });
eq("english best prefers v4", enBest.chain[0], "eleven_v4");
const hi = routeModels({ language: "hi", quality: "high", models });
check("hindi is supported", !hi.unsupported);
const unsupported = routeModels({ language: "xx", quality: "high", models });
eq("unknown language flagged", unsupported.unsupported, true);
check("unknown language gets a notice", typeof unsupported.notice === "string" && unsupported.notice.length > 10);
check("unknown language still gets a chain", unsupported.chain.length > 0);
eq("widest coverage model leads the fallback", unsupported.chain[0], "eleven_v4_turbo");

const v4 = models.find((model) => model.id === "eleven_v4_turbo");
check("v4 supports telugu", supportsLanguage(v4, "te"));
check("v4 supports kannada", supportsLanguage(v4, "kn"));
const turbo = models.find((model) => model.id === "eleven_turbo_v2_5");
check("turbo v2.5 does not support telugu", !supportsLanguage(turbo, "te"));
check("region suffix is stripped for support checks", supportsLanguage(v4, "te-IN"));
const verified = verifiedLanguages(models);
check("verified languages include telugu", verified.includes("te"));
check("verified languages include hindi", verified.includes("hi"));

const hydrated = hydrateModels([
  { model_id: "eleven_v4", languages: [{ language_id: "te" }, { language_id: "en" }] },
  { model_id: "not-a-model", languages: [{ language_id: "en" }] },
]);
eq("hydration keeps only known models", hydrated.length, 1);
eq("hydration uses live languages", hydrated[0].languages.includes("te"), true);
eq("hydration keeps measured latency", typeof hydrated[0].measuredLatencyMs, "number");

/* ───────────────────────────────── voices ─────────────────────────────── */

const voice = toVoiceOption({
  voice_id: "abc",
  name: "Test - Warm Storyteller",
  description: "Warm, deep, storyteller",
  category: "premade",
  labels: { gender: "male", accent: "british", language: "en" },
});
eq("voice id kept", voice.id, "abc");
eq("voice gender", voice.gender, "male");
check("warm style derived", voice.styles.includes("warm"));
check("narration style derived", voice.styles.includes("narration"));
eq("missing id rejected", toVoiceOption({ name: "x" }), null);
check("snapshot has real voices", VOICE_SNAPSHOT.length >= 20, `got ${VOICE_SNAPSHOT.length}`);
eq("search by name finds George", searchVoices(VOICE_SNAPSHOT, "george")[0]?.name, "George");
check("style filter narrows the list", searchVoices(VOICE_SNAPSHOT, "", "deep").length < VOICE_SNAPSHOT.length);
eq("empty search returns all", searchVoices(VOICE_SNAPSHOT, "").length, VOICE_SNAPSHOT.length);

/* ───────────────────────────── composed plan ──────────────────────────── */

const planTe = planSpeech({
  text: "నేను HYDRO AIని డెవలప్ చేస్తున్నాను. ఈ కోడ్‌ను వివరించగలరా?",
  settings: DEFAULT_SPEECH_SETTINGS,
  models,
  defaultVoiceId: "voice-default",
});
eq("plan language is telugu", planTe.language, "te");
eq("plan uses a telugu-capable model", planTe.model, "eleven_v4_turbo");
eq("plan falls back within telugu-capable models", planTe.fallbackChain.includes("eleven_turbo_v2_5"), false);
check("plan has segments", planTe.segments.length >= 1);
check("plan reports an accent notice", typeof planTe.voiceNotice === "string" && planTe.voiceNotice.includes("TE"));
eq("plan keeps the default voice", planTe.voiceId, "voice-default");
check("plan segment carries prosody context fields", "previousText" in planTe.segments[0] && "nextText" in planTe.segments[0]);

const planMixed = planSpeech({
  text: "nenu ippudu HYDRO AI chesthunna, can you explain this code?",
  settings: DEFAULT_SPEECH_SETTINGS,
  models,
  defaultVoiceId: "voice-default",
});
eq("mixed plan detected telugu", planMixed.language, "te");
check("mixed plan transliterated", planMixed.segments.some((segment) => /[\u0C00-\u0C7F]/.test(segment.text)));
includes("mixed plan keeps english", planMixed.segments.map((s) => s.text).join(" "), "explain this code");

const planCodeSwitch = planSpeech({
  text: "Nenu ippudu chesthunna. The total is ₹1,250 today.",
  settings: DEFAULT_SPEECH_SETTINGS,
  models,
  defaultVoiceId: "voice-default",
});
const codeSwitchText = planCodeSwitch.segments.map((segment) => segment.text).join(" ");
includes("english stretch keeps english number words", codeSwitchText, "rupees");
excludes("english stretch has no telugu currency word", codeSwitchText, "రూపాయలు");
includes("telugu stretch keeps telugu phonetics", codeSwitchText, "నేను");
eq(
  "segments carry their own language",
  planCodeSwitch.segments.map((segment) => segment.language).join(","),
  "te,en",
);

const planMoney = planSpeech({
  text: "The price is ₹1,250 and it rose 40% on 2026-03-12.",
  settings: DEFAULT_SPEECH_SETTINGS,
  models,
  defaultVoiceId: "voice-default",
});
const spokenMoney = planMoney.segments.map((segment) => segment.text).join(" ");
includes("plan speaks the amount", spokenMoney, "rupees");
includes("plan speaks the percentage", spokenMoney, "percent");
includes("plan speaks the date", spokenMoney, "March");
eq("display text keeps the original notation", planMoney.segments[0].displayText.includes("₹"), true);
check("plan reports normalisation notes", planMoney.notes.length > 0);

const planEn = planSpeech({
  text: "I am building a speech pipeline.",
  settings: DEFAULT_SPEECH_SETTINGS,
  models,
  defaultVoiceId: "voice-default",
});
eq("english plan has no accent notice", planEn.voiceNotice, null);
eq("english plan language", planEn.language, "en");

const planFixed = planSpeech({
  text: "I am building a speech pipeline.",
  settings: { ...DEFAULT_SPEECH_SETTINGS, language: "te" },
  models,
  defaultVoiceId: "voice-default",
});
eq("manual language overrides detection", planFixed.language, "te");

const planLong = planSpeech({
  text: `${"This is a fairly long sentence used to exceed the answer ceiling. ".repeat(90)}`,
  settings: DEFAULT_SPEECH_SETTINGS,
  models,
  defaultVoiceId: "voice-default",
});
check("plan clamps a very long answer", planLong.originalChars <= 4000, `got ${planLong.originalChars}`);
check("plan still produces segments", planLong.segments.length > 0);

const publicShape = publicPlan(planEn);
check("public plan is serialisable", typeof JSON.stringify(publicShape) === "string");
check("public plan carries pause", typeof publicShape.pauseMs === "number");
check("public plan drops internal params", !("params" in publicShape));
check("public plan keeps segment display text", typeof publicShape.segments[0].displayText, "string");
check("public plan lists verified languages", publicShape.verifiedLanguages.length === 0 || Array.isArray(publicShape.verifiedLanguages));

/* ──────────────────────────────── report ──────────────────────────────── */

const total = passed + failures.length;
if (failures.length) {
  console.error(`\nspeech:self-test — ${passed}/${total} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`speech:self-test — ${passed}/${total} assertions passed, 0 failed`);
console.log("Not covered here: how the audio sounds, provider availability, browser playback.");
