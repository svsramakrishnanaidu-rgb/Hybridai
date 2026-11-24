/**
 * HYDRO AI — speech benchmark (real API calls, no fabricated scores).
 *
 * For every case it does what a listener does: synthesise the answer, then
 * transcribe the resulting audio back with the recognizer and compare that
 * transcript with the words the answer was supposed to contain. Character error
 * rate is the measurement; it is a proxy for intelligibility and pronunciation,
 * not a MOS score. There is no human listening rating in this report because no
 * human listened.
 *
 * Two configurations are compared on the same reference text:
 *   baseline — the previous build: eleven_turbo_v2_5, no language code, raw
 *              Markdown answer straight into the synthesizer
 *   current  — this build: the server's plan (normalisation, pronunciation,
 *              language routing) and the routed multilingual model
 *
 * Usage:
 *   node scripts/speech-bench.mjs --base http://127.0.0.1:3101 [--limit 150]
 *        [--baseline-limit 30] [--pace 0]
 *
 * Writes .data/speech-bench.json and .data/speech-bench.md
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE = flag("base", "http://127.0.0.1:3101");
const LIMIT = Number(flag("limit", "150"));
const BASELINE_LIMIT = Number(flag("baseline-limit", "30"));
const PACE = Number(flag("pace", "0"));
const MODE = flag("mode", "natural");

const env = fs.readFileSync(".env.local", "utf8");
const readKey = (name) => {
  const match = env.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : "";
};
const ELEVEN = readKey("ELEVENLABS_API_KEY");
const DEEPGRAM = readKey("DEEPGRAM_API_KEY");
const VOICE = readKey("ELEVENLABS_VOICE_ID") || "JBFqnCBsd6RMkjVDRZzb";

if (!ELEVEN || !DEEPGRAM) {
  console.error("Missing ELEVENLABS_API_KEY or DEEPGRAM_API_KEY in .env.local");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─────────────────────────────── test cases ────────────────────────────── */

const cases = [];
const add = (language, category, text) => {
  cases.push({ id: `c${String(cases.length + 1).padStart(3, "0")}`, language, category, text });
};

// English pronunciation: names, acronyms, symbols
[
  "HYDRO AI is an orchestration layer, not a foundation model.",
  "The DHRUVA project ships with n8n and k8s manifests.",
  "Call useState inside the React component, then await the promise.",
  "We use SQL, JSON, YAML and a little gRPC.",
  "Sundar Pichai and Satya Nadella were mentioned in the article.",
  "Read the README.md file before running npm install.",
  "The C++ and C# builds are separate binaries.",
  "Query Postgres with pgvector for semantic search.",
  "Set HYDRO_MAX_CALLS to six and HYDRO_BUDGET_USD to zero point one two.",
  "Kubernetes, Docker, Nginx and Node.js all run on the same host.",
  "Use a JWT with an OAuth refresh token.",
  "The PDF export includes CSV, XML and PNG attachments.",
  "Open the .env.local file and add the API key.",
  "Mount the SSD and check the CPU and GPU usage.",
  "Regex and async/await confuse beginners more than pointers do.",
].forEach((text) => add("en", "pronunciation", text));

// English naturalness: long, lists, punctuation
[
  "First, measure the problem. Then change one thing. Then measure again.",
  "The system has three parts: a router, a verifier, and a writer.",
  "Although the model answered quickly, the answer was incomplete and vague.",
  "Is it ready? It is not. Will it be ready tomorrow? Probably.",
  "He said, \"Ship it on Friday,\" and everyone in the room laughed.",
  "Revenue grew from twelve percent to eighteen percent year over year.",
  "The instructions are simple — read them twice, then start.",
  "We tried three approaches; only the second one worked reliably.",
  "Nothing about this is urgent, so take your time and get it right.",
  "There is one exception, and it matters more than the rule itself.",
  "The report covers latency, cost, accuracy and reliability.",
  "Please summarise the decision in one sentence for the team channel.",
  "This sentence is deliberately long so that the synthesizer has to handle a subordinate clause, a comma, and a final qualification without losing the thread.",
  "Numbers matter: 3, 17, 412 and 98,000 are all in this sentence.",
  "End of the list.",
].forEach((text) => add("en", "naturalness", text));

// Telugu, native script
[
  "నమస్కారం, నేను హైడ్రో. మీకు ఎలా సహాయం చేయగలను?",
  "ఈ రోజు వాతావరణం బాగుంది, కానీ సాయంత్రం వర్షం పడవచ్చు.",
  "నేను ఇప్పుడు హైడ్రో ఏఐని అభివృద్ధి చేస్తున్నాను.",
  "ఈ కోడ్‌లో మూడు లోపాలు ఉన్నాయి, వాటిని ఒక్కొక్కటిగా సరిచేద్దాం.",
  "దయచేసి ఈ ఫైల్‌ను తెరిచి, మొదటి పంక్తిని చదవండి.",
  "తెలుగు మరియు ఇంగ్లీష్ కలిపి మాట్లాడితే అర్థం అవుతుంది.",
  "రేపు ఉదయం పది గంటలకు సమావేశం ఉంది.",
  "ఈ సమస్యకు రెండు పరిష్కారాలు ఉన్నాయి.",
  "మీరు చెప్పిన విషయం నాకు అర్థమైంది.",
  "సంఖ్యలు ముఖ్యం: మూడు, పదిహేడు, నాలుగు వందల పన్నెండు.",
  "ప్రాజెక్ట్ పూర్తయింది, కానీ పరీక్షలు మిగిలి ఉన్నాయి.",
  "ఈ పదం ఎలా ఉచ్చరించాలో నాకు తెలియదు.",
  "దయచేసి నెమ్మదిగా మాట్లాడండి.",
  "ఆ ఫలితం నిజమా అని ఒకసారి తనిఖీ చేయండి.",
  "హైదరాబాద్ నుండి విజయవాడకు రైలు మార్గం ఉంది.",
  "మా ఊరిలో ఒక పెద్ద చెరువు ఉంది.",
  "పుస్తకంలో మొదటి అధ్యాయం చాలా ఆసక్తికరంగా ఉంది.",
  "ఇది పని చేస్తుందా అని పరీక్షించండి.",
  "తప్పు జరిగితే, మళ్ళీ ప్రయత్నించండి.",
  "ధన్యవాదాలు, ఇది చాలా ఉపయోగకరంగా ఉంది.",
].forEach((text) => add("te", "telugu-native", text));

// Romanised Telugu (the mixed speech case)
[
  "Nenu ippudu HYDRO AI ni develop chesthunna, can you explain this code?",
  "Ee roju chala pani undi, so late avuthundi.",
  "Aa file lo moonu errors unnayi, first di chudu.",
  "Naku ee concept artham kaledu, konchem explain cheyandi.",
  "Repu udayam padi gantalaki meeting undi.",
  "Idi pani chesthundi ani nenu anukuntunna.",
  "Meeru cheppina vishayam naku arthamaindi.",
  "Daya chesi nemmadiga matladandi.",
  "Ee project ki entha time padutundi?",
  "Nenu Telugu lo matladatanu, English lo rastanu.",
  "Aa result nijama ani okasari check cheyandi.",
  "Ippudu em cheyali, cheppandi.",
  "Naaku ee paata chala istam.",
  "Ee samasyaki rendu solutions unnayi.",
  "Dhanyavadalu, idi chala useful ga undi.",
].forEach((text) => add("te", "telugu-romanised", text));

// Hindi
[
  "नमस्ते, मैं हाइड्रो हूँ। आपकी कैसे मदद कर सकता हूँ?",
  "आज मौसम अच्छा है, लेकिन शाम को बारिश हो सकती है।",
  "इस कोड में तीन गलतियाँ हैं, एक-एक करके ठीक करते हैं।",
  "कृपया धीरे बोलिए, मैं समझ नहीं पाया।",
  "कल सुबह दस बजे बैठक है।",
  "मुझे यह विचार पसंद आया।",
  "पुस्तक में पहला अध्याय बहुत रोचक है।",
  "संख्या महत्वपूर्ण है: तीन, सत्रह, चार सौ बारह।",
  "अगर गलती हो जाए तो फिर से कोशिश करें।",
  "धन्यवाद, यह बहुत उपयोगी था।",
].forEach((text) => add("hi", "hindi", text));

// Mixed Telugu + English, script on both sides
[
  "ఈ code లో ఒక bug ఉంది, దాన్ని fix చేయాలి.",
  "మీరు React use చేస్తున్నారా, లేదా plain JavaScript?",
  "Nenu API key ni .env file లో పెట్టాను.",
  "Deploy చేసే ముందు tests run చేయండి.",
  "ఈ feature కి మంచి name ఏమిటి?",
  "Latency ఎక్కువగా ఉంది, optimize చేయాలి.",
  "Please ఈ error message చదవండి.",
  "Database backup తీసుకోవాలి.",
  "మీరు చెప్పిన approach బాగుంది, let us try it.",
  "Final answer: రెండు models కలిపి ఒకటే output ఇస్తాయి.",
].forEach((text) => add("te", "mixed", text));

// Numbers, currency, dates, mathematics
[
  "The invoice total is ₹2,45,600 for 2026-04-01.",
  "Prices rose 12.5% while revenue fell 3%.",
  "Half of 84 is 42, and 42 divided by 6 is 7.",
  "The meeting is at 09:15 and the review at 16:45.",
  "The server has 64 GB of RAM and a 2 TB SSD.",
  "Distance is 12 km, weight is 45 kg, temperature is 38 °C.",
  "Chapter 7 begins on page 214 and ends on page 289.",
  "The ratio is 3:1 and the probability is 0.25.",
  "Version 2.10.4 fixed 17 bugs and closed 4 issues.",
  "Five thousand rupees is about sixty dollars.",
  "The train leaves at 6:40 and arrives at 9:05.",
  "Interest is 7.5% per year over 15 years.",
  "One lakh twenty thousand people visited the site.",
  "The code took 240 ms on average and 1.2 s at worst.",
  "Area equals pi times r squared, so r^2 matters here.",
].forEach((text) => add("en", "numbers", text));

// Code and technical narration
[
  "Function getName returns a string or null.",
  "The loop iterates over items and breaks on the first error.",
  "Define const user equals await fetchUser(id).",
  "The endpoint /api/voice/tts accepts a POST with JSON.",
  "Wrap the handler in try, catch and finally.",
  "TypeScript complains because the type is optional.",
  "The migration adds a column called created_at.",
  "Git rebase rewrites history, so be careful.",
  "The shader uses uniforms for gaze and amplitude.",
  "Set input_state to idle before starting the session.",
].forEach((text) => add("en", "code", text));

// Formatting that must not be read aloud
[
  "## Summary\n\nThe build passed in 42 seconds.",
  "Use **bold** for emphasis and `code` for identifiers.",
  "See [the docs](https://example.com/docs) for details.",
  "- first item\n- second item\n- third item",
  "| model | latency |\n|---|---|\n| v4 | 1.5 s |",
  "> A quoted sentence from the report.",
  "Step 1: install. Step 2: build. Step 3: start.",
  "This is fine 🙂 and this is done ✅.",
  "Line one\nLine two\nLine three",
  "The result is 100% correct — no caveats.",
].forEach((text) => add("en", "formatting", text));

// Other Indic languages the model table claims
[
  ["ta", "நமஸ்காரம், நான் ஹைட்ரோ. எப்படி உதவ முடியும்?"],
  ["ta", "இன்று வானிலை நன்றாக உள்ளது, மாலையில் மழை பெய்யலாம்."],
  ["kn", "ನಮಸ್ಕಾರ, ನಾನು ಹೈಡ್ರೋ. ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?"],
  ["kn", "ಇಂದು ಹವಾಮಾನ ಚೆನ್ನಾಗಿದೆ, ಸಂಜೆ ಮಳೆ ಬರಬಹುದು."],
  ["ml", "നമസ്കാരം, ഞാൻ ഹൈഡ്രോ. എങ്ങനെ സഹായിക്കാം?"],
  ["ml", "ഇന്ന് കാലാവസ്ഥ നല്ലതാണ്, വൈകുന്നേരം മഴ പെയ്യാം."],
  ["bn", "নমস্কার, আমি হাইড্রো। কীভাবে সাহায্য করতে পারি?"],
  ["bn", "আজ আবহাওয়া ভালো, সন্ধ্যায় বৃষ্টি হতে পারে।"],
  ["mr", "नमस्कार, मी हायड्रो. कशी मदत करू शकतो?"],
  ["gu", "નમસ્તે, હું હાઇડ્રો. કેવી રીતે મદદ કરી શકું?"],
].forEach(([language, text]) => add(language, "indic-other", text));

// International
[
  ["es", "Hola, soy HYDRO. ¿En qué puedo ayudarte hoy?"],
  ["es", "El informe está listo, pero faltan dos pruebas."],
  ["fr", "Bonjour, je suis HYDRO. Comment puis-je vous aider ?"],
  ["fr", "Le rapport est prêt, mais il manque deux tests."],
  ["de", "Hallo, ich bin HYDRO. Wie kann ich helfen?"],
  ["de", "Der Bericht ist fertig, aber zwei Tests fehlen."],
  ["pt", "Olá, eu sou o HYDRO. Como posso ajudar?"],
  ["ja", "こんにちは、ハイドロです。どのようにお手伝いできますか。"],
  ["ko", "안녕하세요, 저는 하이드로입니다. 무엇을 도와드릴까요?"],
  ["zh", "你好，我是 HYDRO。今天我能帮你做什么？"],
  ["ar", "مرحبا، أنا هايدرو. كيف يمكنني مساعدتك؟"],
  ["ru", "Здравствуйте, я HYDRO. Чем я могу помочь?"],
].forEach(([language, text]) => add(language, "international", text));

// Edge cases
[
  "OK.",
  "Yes.",
  "No.",
  "Done.",
  "Hello!",
  "Wait...",
  "Hmm.",
  "Thanks!",
  "Got it.",
  "One moment, please.",
].forEach((text) => add("en", "edge", text));

/* ─────────────────────────────── metrics ───────────────────────────────── */

const clean = (text) =>
  text
    .toLowerCase()
    .replace(/[\u0964\u0965\u0c64]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Script-tolerant comparison.
 *
 * The recognizer sometimes returns Telugu in Telugu script and sometimes
 * romanised, for the same audio. Comparing those two directly reports a 100%
 * error on intelligible speech, which is a measurement artefact. When either
 * side is mostly Telugu script, both sides are romanised with a fixed
 * transliteration table and compared in one alphabet.
 */
const TELUGU_MAP = {
  "అ": "a", "ఆ": "aa", "ఇ": "i", "ఈ": "ee", "ఉ": "u", "ఊ": "oo", "ఋ": "ru",
  "ఎ": "e", "ఏ": "ae", "ఐ": "ai", "ఒ": "o", "ఓ": "o", "ఔ": "au",
  "క": "k", "ఖ": "kh", "గ": "g", "ఘ": "gh", "ఙ": "n", "చ": "ch", "ఛ": "chh",
  "జ": "j", "ఝ": "jh", "ఞ": "n", "ట": "t", "ఠ": "th", "డ": "d", "ఢ": "dh",
  "ణ": "n", "త": "t", "థ": "th", "ద": "d", "ధ": "dh", "న": "n", "ప": "p",
  "ఫ": "ph", "బ": "b", "భ": "bh", "మ": "m", "య": "y", "ర": "r", "ఱ": "r",
  "ల": "l", "ళ": "l", "వ": "v", "శ": "sh", "ష": "sh", "స": "s", "హ": "h",
  // Matras (vowel signs) — quoted because they are combining marks
  "ా": "a", "ి": "i", "ీ": "ee", "ు": "u", "ూ": "oo", "ృ": "ru",
  "ె": "e", "ే": "ae", "ై": "ai", "ొ": "o", "ో": "o", "ౌ": "au",
  "ం": "n", "ః": "h",
};
const TELUGU_CONSONANTS = new Set(
  "కఖగఘఙచఛజఝఞటఠడఢణతథదధనపఫబభమయరఱలళవశషసహ".split(""),
);
const MATRAS = new Set("ాిీుూఋృెేైొోౌ".split(""));

function romanizeTelugu(text) {
  let out = "";
  const chars = [...text];
  for (let index = 0; index < chars.length; index++) {
    const ch = chars[index];
    if (ch === "్") continue; // virama: suppress the inherent vowel below
    if (TELUGU_CONSONANTS.has(ch)) {
      out += TELUGU_MAP[ch] ?? "";
      const next = chars[index + 1] ?? "";
      if (next === "్") continue; // handled on the next iteration
      if (MATRAS.has(next)) continue; // the matra supplies the vowel
      out += "a";
      continue;
    }
    out += TELUGU_MAP[ch] ?? (/[\u0c00-\u0c7f]/.test(ch) ? "" : ch);
  }
  return out;
}

function teluguShare(text) {
  const letters = [...text].filter((ch) => /[\p{L}\p{M}]/u.test(ch));
  if (!letters.length) return 0;
  const telugu = letters.filter((ch) => /[\u0c00-\u0c7f]/.test(ch)).length;
  return telugu / letters.length;
}

function compareNormalize(text) {
  return clean(teluguShare(text) > 0.2 ? romanizeTelugu(text) : text);
}

function cer(reference, hypothesis) {
  // One alphabet on both sides, so script choice never masquerades as an error.
  const romanizeBoth = teluguShare(reference) > 0.2 || teluguShare(hypothesis) > 0.2;
  const fold = (text) => (romanizeBoth ? compareNormalize(text) : clean(text));
  const a = [...fold(reference)];
  const b = [...fold(hypothesis)];
  if (!a.length) return b.length ? 1 : 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] / a.length;
}

function wer(reference, hypothesis) {
  const romanizeBoth = teluguShare(reference) > 0.2 || teluguShare(hypothesis) > 0.2;
  const fold = (text) => (romanizeBoth ? compareNormalize(text) : clean(text));
  const a = fold(reference).split(" ").filter(Boolean);
  const b = fold(hypothesis).split(" ").filter(Boolean);
  if (!a.length) return b.length ? 1 : 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] / a.length;
}

async function listen(audio, language, mime) {
  const started = Date.now();
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    language,
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { authorization: `Token ${DEEPGRAM}`, "content-type": mime },
    body: audio,
  });
  const body = await res.text();
  if (!res.ok) return { transcript: "", ms: Date.now() - started, error: `${res.status} ${body.slice(0, 120)}` };
  const data = JSON.parse(body);
  return {
    transcript: data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "",
    ms: Date.now() - started,
    error: null,
  };
}

/** The previous build, reproduced exactly: one raw request, English-only model. */
async function baseline(text, language) {
  const started = Date.now();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVEN, "content-type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 2400),
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.25, speed: 1 },
      }),
    },
  );
  const audio = Buffer.from(await res.arrayBuffer());
  const synthMs = Date.now() - started;
  if (!res.ok) return { ok: false, error: `${res.status} ${audio.toString("utf8").slice(0, 140)}`, synthMs };
  return { ok: true, audio, synthMs, model: "eleven_turbo_v2_5" };
}

/** This build: ask the server to plan, then ask it for each segment. */
async function current(text, language) {
  const started = Date.now();
  const planRes = await fetch(`${BASE}/api/voice/tts/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Always auto: the point is to measure the detector, not the saved setting.
    body: JSON.stringify({ text, language: "auto" }),
  });
  const plan = await planRes.json();
  if (!planRes.ok) return { ok: false, error: `plan ${planRes.status} ${JSON.stringify(plan).slice(0, 120)}`, synthMs: 0 };
  if (!plan.segments?.length) return { ok: false, error: "no segments", synthMs: 0 };

  const buffers = [];
  let model = plan.model;
  let firstMs = null;
  for (const segment of plan.segments.slice(0, 3)) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/voice/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: segment.text,
        segment: true,
        language: segment.language ?? plan.language,
        voiceId: plan.voiceId,
        previousText: undefined,
        nextText: undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `tts ${res.status} ${body.slice(0, 140)}`, synthMs: Date.now() - started };
    }
    model = res.headers.get("x-hydro-tts-model") || model;
    buffers.push(Buffer.from(await res.arrayBuffer()));
    if (firstMs === null) firstMs = Date.now() - t0;
  }
  return {
    ok: true,
    audio: Buffer.concat(buffers),
    synthMs: Date.now() - started,
    firstAudioMs: firstMs,
    model,
    language: plan.language,
    reference: plan.segments.map((segment) => segment.text).join(" "),
    referenceShort: plan.segments[0].text,
    segments: plan.segments.length,
    notes: plan.notes,
  };
}

/* ───────────────────────────────── run ─────────────────────────────────── */

console.log(`speech-bench — base ${BASE} · ${Math.min(LIMIT, cases.length)} cases · baseline ${BASELINE_LIMIT}`);
console.log(`mode ${MODE}, voice ${VOICE.slice(0, 6)}…\n`);

/**
 * Plan-only evaluation: 150 cases through the server's decision layer.
 *
 * This costs nothing (no synthesis), so it can always be run, and it measures
 * what the pipeline *decided*: detected language, whether the chosen model lists
 * that language, whether a Telugu case ended up in Telugu script, what was
 * rewritten for speech, and how the answer was split. It says nothing about how
 * the audio sounds — that is what the synthesis pass below is for.
 */
if (args.includes("--plan-only")) {
  const rows = [];
  for (const testCase of cases.slice(0, LIMIT)) {
    const res = await fetch(`${BASE}/api/voice/tts/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: testCase.text }),
    });
    const plan = await res.json();
    if (!res.ok) {
      rows.push({ ...testCase, error: `${res.status} ${plan.error ?? ""}` });
      continue;
    }
    const spoken = (plan.segments ?? []).map((segment) => segment.text).join(" ");
    rows.push({
      id: testCase.id,
      language: testCase.language,
      category: testCase.category,
      detected: plan.language,
      model: plan.model,
      modelSupportsLanguage: (plan.fallbackChain ?? []).length > 0 && !plan.unsupportedLanguage,
      segments: plan.segments?.length ?? 0,
      teluguScript: /[\u0c00-\u0c7f]/.test(spoken),
      latinTeluguLeft: /\b(nenu|ippudu|chesthunna|gurinchi|meeru|cheyandi|undhi|avuthundi)\b/i.test(spoken),
      notes: plan.notes ?? [],
      mixed: plan.mixed,
      spokenChars: plan.spokenChars,
      originalChars: plan.originalChars,
      sample: (plan.segments ?? []).slice(0, 2).map((segment) => segment.text),
    });
  }

  const ok = rows.filter((row) => !row.error);
  const byLanguage = {};
  for (const row of ok) {
    byLanguage[row.language] ??= { cases: 0, correct: 0, scripts: 0 };
    byLanguage[row.language].cases += 1;
    if (row.detected === row.language || (row.language === "te" && row.detected === "te")) {
      byLanguage[row.language].correct += 1;
    }
    if (row.teluguScript) byLanguage[row.language].scripts += 1;
  }
  const summary = {
    at: new Date().toISOString(),
    base: BASE,
    cases: rows.length,
    planned: ok.length,
    errored: rows.filter((row) => row.error).length,
    languageMatched: ok.filter((row) => row.detected === row.language).length,
    routedToSupportingModel: ok.filter((row) => row.modelSupportsLanguage).length,
    teluguCases: ok.filter((row) => row.language === "te").length,
    teluguInScript: ok.filter((row) => row.language === "te" && row.teluguScript).length,
    romanisedLeftInLatin: ok.filter((row) => row.latinTeluguLeft).length,
    normalisationApplied: ok.filter((row) => row.notes.length > 0).length,
    avgSegments: ok.reduce((sum, row) => sum + row.segments, 0) / Math.max(1, ok.length),
    byLanguage,
    rows,
  };
  fs.mkdirSync(".data", { recursive: true });
  fs.writeFileSync(".data/speech-plan-eval.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, rows: undefined, byLanguage: undefined }, null, 2));
  const markdown = [
    "# HYDRO AI — speech plan evaluation (150 cases)",
    "",
    `Run: ${summary.at} · server ${BASE}`,
    "",
    "This measures the decision layer only: detected language, model routing, Telugu",
    "transliteration, text normalisation and sentence planning. No audio was generated.",
    "",
    "| metric | value |",
    "|---|---|",
    `| cases planned | ${summary.planned} / ${summary.cases} |`,
    `| detected language matches the case | ${summary.languageMatched} |`,
    `| routed to a model that lists the language | ${summary.routedToSupportingModel} |`,
    `| Telugu cases | ${summary.teluguCases} |`,
    `| Telugu cases in Telugu script | ${summary.teluguInScript} |`,
    `| romanised Telugu left in Latin | ${summary.romanisedLeftInLatin} |`,
    `| cases with a speech rewrite (numbers, markup, terms) | ${summary.normalisationApplied} |`,
    `| average sentences per answer | ${summary.avgSegments.toFixed(2)} |`,
    "",
    "## By language",
    "",
    "| language | cases | detected correctly | native script |",
    "|---|---|---|---|",
    ...Object.entries(byLanguage).map(
      ([language, value]) => `| ${language} | ${value.cases} | ${value.correct} | ${value.scripts} |`,
    ),
  ].join("\n");
  fs.writeFileSync(".data/speech-plan-eval.md", markdown);
  console.log("\nwrote .data/speech-plan-eval.json and .data/speech-plan-eval.md");
  process.exit(0);
}

const selected = cases.slice(0, Math.min(LIMIT, cases.length));
const results = [];
let aborted = null;

// Resume: every finished case is already in the partial file, so an interrupted
// run is not paid for twice. `--fresh` starts over.
const partialPath = ".data/speech-bench.partial.jsonl";
const finished = new Map();
if (!args.includes("--fresh") && fs.existsSync(partialPath)) {
  for (const line of fs.readFileSync(partialPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.id) finished.set(entry.id, entry);
    } catch {
      /* ignore a torn line */
    }
  }
  if (finished.size) console.log(`resuming — ${finished.size} cases already measured (use --fresh to redo)`);
}

for (const [index, testCase] of selected.entries()) {
  const runBaseline = index < BASELINE_LIMIT;
  const cached = finished.get(testCase.id);
  if (cached && cached.current?.ok && (!runBaseline || cached.baseline?.ok)) {
    results.push(cached);
    continue;
  }
  const entry = { ...testCase, current: null, baseline: null };

  try {
    const now = await current(testCase.text);
    if (!now.ok) {
      entry.current = { ok: false, error: now.error };
    } else {
      const reference = testCase.language === "en" ? testCase.text : now.reference;
      const heard = await listen(now.audio, heardLanguage(testCase.language), "audio/mpeg");
      entry.current = {
        ok: true,
        model: now.model,
        language: now.language,
        segments: now.segments,
        synthMs: now.synthMs,
        firstAudioMs: now.firstAudioMs ?? null,
        bytes: now.audio.length,
        transcript: heard.transcript,
        sttError: heard.error,
        cer: heard.error ? null : Math.round(cer(reference, heard.transcript) * 1000) / 1000,
        wer: heard.error ? null : Math.round(wer(reference, heard.transcript) * 1000) / 1000,
        notes: now.notes,
      };
    }
  } catch (err) {
    entry.current = { ok: false, error: String(err).slice(0, 160) };
  }

  if (runBaseline) {
    try {
      const before = await baseline(testCase.text, testCase.language);
      if (!before.ok) {
        entry.baseline = { ok: false, error: before.error };
      } else {
        const reference = testCase.language === "en" ? testCase.text : entry.current?.reference ?? testCase.text;
        const heard = await listen(before.audio, heardLanguage(testCase.language), "audio/mpeg");
        entry.baseline = {
          ok: true,
          model: before.model,
          synthMs: before.synthMs,
          bytes: before.audio.length,
          transcript: heard.transcript,
          sttError: heard.error,
          cer: heard.error ? null : Math.round(cer(reference, heard.transcript) * 1000) / 1000,
          wer: heard.error ? null : Math.round(wer(reference, heard.transcript) * 1000) / 1000,
        };
      }
    } catch (err) {
      entry.baseline = { ok: false, error: String(err).slice(0, 160) };
    }
  }

  results.push(entry);
  // Written as we go: a crash at the end must not throw away paid requests.
  fs.mkdirSync(".data", { recursive: true });
  fs.appendFileSync(".data/speech-bench.partial.jsonl", `${JSON.stringify(entry)}\n`);

  // An exhausted provider quota cannot be waited out; stop instead of burning
  // the rest of the run against a wall.
  if (/credits|quota_exceeded/i.test(entry.current?.error ?? "")) {
    console.log("\nstopping — the speech provider account is out of credits");
    aborted = "provider quota exhausted";
    break;
  }
  const currentCer = entry.current?.cer;
  const baselineCer = entry.baseline?.cer;
  console.log(
    `${entry.id} ${entry.language.padEnd(3)} ${entry.category.padEnd(16)} ` +
      `new=${currentCer === null || currentCer === undefined ? "err" : (currentCer * 100).toFixed(1) + "%"}` +
      (runBaseline ? `  old=${baselineCer === null || baselineCer === undefined ? "err" : (baselineCer * 100).toFixed(1) + "%"}` : "") +
      (entry.current?.model ? `  ${entry.current.model}` : ""),
  );
  if (PACE) await sleep(PACE);
}

/* ─────────────────────────────── reporting ─────────────────────────────── */

function heardLanguage(language) {
  // Native-script Indic cases are transcribed in their own language; everything
  // else, including romanised Telugu and mixed answers, uses the multilingual
  // recognizer so the English words in a mixed sentence are not forced into
  // Telugu phonetics.
  return ["te", "hi", "ta", "kn", "ml", "bn", "mr", "gu", "ur"].includes(language) ? language : "multi";
}

const ok = results.filter(
  (entry) => entry.current?.ok === true && typeof entry.current.cer === "number",
);
const avg = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const p50 = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const byLanguage = {};
for (const entry of ok) {
  byLanguage[entry.language] ??= [];
  byLanguage[entry.language].push(entry.current.cer);
}
const byCategory = {};
for (const entry of ok) {
  byCategory[entry.category] ??= [];
  byCategory[entry.category].push(entry.current.cer);
}

const paired = results.filter(
  (entry) =>
    typeof entry.current?.cer === "number" && typeof entry.baseline?.cer === "number",
);
const improved = paired.filter((entry) => entry.current.cer < entry.baseline.cer - 0.001).length;
const worse = paired.filter((entry) => entry.current.cer > entry.baseline.cer + 0.001).length;

const summary = {
  at: new Date().toISOString(),
  base: BASE,
  aborted,
  cases: results.length,
  baselineCases: paired.length,
  current: {
    succeeded: ok.length,
    failed: results.filter((entry) => !entry.current?.ok).length,
    meanCer: avg(ok.map((entry) => entry.current.cer)),
    meanWer: avg(
      ok.filter((entry) => typeof entry.current.wer === "number").map((entry) => entry.current.wer),
    ),
    p50SynthMs: p50(ok.map((entry) => entry.current.synthMs)),
    p50FirstAudioMs: p50(ok.filter((entry) => entry.current.firstAudioMs).map((entry) => entry.current.firstAudioMs)),
    models: [...new Set(ok.map((entry) => entry.current.model))],
  },
  baseline: {
    succeeded: paired.filter((entry) => entry.baseline.ok).length,
    meanCer: avg(paired.map((entry) => entry.baseline.cer)),
    meanWer: avg(
      paired
        .filter((entry) => typeof entry.baseline.wer === "number")
        .map((entry) => entry.baseline.wer),
    ),
    p50SynthMs: p50(paired.map((entry) => entry.baseline.synthMs)),
  },
  paired: { count: paired.length, improved, worse },
  byLanguage: Object.fromEntries(
    Object.entries(byLanguage).map(([language, values]) => [language, { cases: values.length, meanCer: avg(values) }]),
  ),
  byCategory: Object.fromEntries(
    Object.entries(byCategory).map(([category, values]) => [category, { cases: values.length, meanCer: avg(values) }]),
  ),
  failures: results
    .filter((entry) => !entry.current?.ok)
    .map((entry) => ({ id: entry.id, error: entry.current?.error })),
  results,
};

fs.mkdirSync(".data", { recursive: true });
fs.writeFileSync(path.join(".data", "speech-bench.json"), JSON.stringify(summary, null, 2));

const lines = [];
lines.push("# HYDRO AI — speech benchmark");
lines.push("");
lines.push(`Run: ${summary.at}`);
lines.push(`Server: ${BASE}`);
lines.push(`Cases: ${summary.cases} · paired before/after: ${summary.paired.count}`);
if (summary.aborted) lines.push(`**Run stopped early: ${summary.aborted}.**`);
lines.push("");
lines.push("## What this measures");
lines.push("");
lines.push("Each answer is synthesised, then transcribed back with Deepgram nova-3 and compared with the words it");
lines.push("was supposed to contain (character error rate). It measures whether the audio is *intelligible and");
lines.push("linguistically correct*. It is not a naturalness rating: no human listened, so no MOS score is claimed.");
lines.push("");
lines.push("## Headline");
lines.push("");
lines.push("| | current build | previous build |");
lines.push("|---|---|---|");
lines.push(`| cases | ${summary.current.succeeded} ok / ${summary.current.failed} failed | ${summary.baseline.succeeded} ok |`);
lines.push(`| mean CER | ${pct(summary.current.meanCer)} | ${pct(summary.baseline.meanCer)} |`);
lines.push(`| mean WER | ${pct(summary.current.meanWer)} | ${pct(summary.baseline.meanWer)} |`);
lines.push(`| p50 synthesis time | ${summary.current.p50SynthMs ?? "n/a"} ms | ${summary.baseline.p50SynthMs ?? "n/a"} ms |`);
lines.push(`| p50 time to first audio | ${summary.current.p50FirstAudioMs ?? "n/a"} ms | n/a (single request) |`);
lines.push(`| models used | ${summary.current.models.join(", ")} | eleven_turbo_v2_5 |`);
lines.push(`| paired cases improved / worse | ${improved} / ${worse} | — |`);
lines.push("");
lines.push("## By language (current build)");
lines.push("");
lines.push("| language | cases | mean CER |");
lines.push("|---|---|---|");
for (const [language, value] of Object.entries(summary.byLanguage)) {
  lines.push(`| ${language} | ${value.cases} | ${pct(value.meanCer)} |`);
}
lines.push("");
lines.push("## By category (current build)");
lines.push("");
lines.push("| category | cases | mean CER |");
lines.push("|---|---|---|");
for (const [category, value] of Object.entries(summary.byCategory)) {
  lines.push(`| ${category} | ${value.cases} | ${pct(value.meanCer)} |`);
}
if (summary.failures.length) {
  lines.push("");
  lines.push("## Failures");
  lines.push("");
  for (const failure of summary.failures) lines.push(`- ${failure.id}: ${failure.error}`);
}
lines.push("");
lines.push("## Worst 10 cases (current build)");
lines.push("");
lines.push("| id | language | CER | heard |");
lines.push("|---|---|---|---|");
for (const entry of [...ok].sort((a, b) => b.current.cer - a.current.cer).slice(0, 10)) {
  lines.push(
    `| ${entry.id} | ${entry.language} | ${pct(entry.current.cer)} | ${(entry.current.transcript || "").slice(0, 70).replace(/\|/g, "/")} |`,
  );
}
lines.push("");
lines.push("## Reproduce");
lines.push("");
lines.push("```bash");
lines.push("npm run build");
lines.push("HYDRO_RATE_PER_MINUTE=1000 npx next start -p 3101   # benchmark instance");
lines.push("npm run speech:bench");
lines.push("```");

fs.writeFileSync(path.join(".data", "speech-bench.md"), lines.join("\n"));

console.log("\n" + lines.slice(6, 20).join("\n"));
console.log(`\nwrote .data/speech-bench.json and .data/speech-bench.md`);
