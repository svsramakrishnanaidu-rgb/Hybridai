/**
 * HYDRO AI — deterministic intent classification.
 * No model call is spent on routing. The classifier is a transparent heuristic so
 * the trace can explain exactly why a team was chosen.
 */

import type { Intent, TaskProfile } from "@/core/types";

const TELUGU = /[\u0C00-\u0C7F]/;
const LATIN = /[a-zA-Z]{3,}/;

const DOMAIN_HINTS: Array<[TaskProfile["domain"], RegExp]> = [
  ["coding", /\b(code|function|class|bug|error|typescript|javascript|python|react|sql|api|compile|regex|refactor|component)\b/i],
  [
    "math",
    /\b(solve|integral|derivative|prove|equation|matrix|probability|theorem|calculate|sum|mean|how many|how much|percent|percentage|discount|days? (?:from now|ago)|day of the week)\b/i,
  ],
  ["research", /\b(research|source|study|paper|evidence|compare|market|history|explain why|survey)\b/i],
  ["writing", /\b(write|draft|email|essay|caption|story|rewrite|tone|copy)\b/i],
  ["analysis", /\b(analyse|analyze|evaluate|trade-?off|pros and cons|strategy|impact|risk)\b/i],
];

/**
 * Romanised Telugu that people actually type ("ee API ki auth ela add cheyali").
 * Telugu script is detected directly; without this, a romanised Telugu request
 * classifies as English and the reply drifts into pure English. Two distinct
 * markers are required so an English sentence that happens to contain one short
 * syllable is not misread.
 */
const ROMAN_TELUGU =
  /\b(chey|cheyyi|cheyali|cheyyali|cheppu|cheppandi|chestunna|kavali|kaadu|kadu|ledu|avunu|ela|elaa|enti|emiti|nenu|meeru|manam|vachina|chalu|chaalu|tho|ki|lo|ga|gurinchi|kosam|kuda|unnaru|undi|ayyindi|avutundi|ikkada|akkada|enti|ante|aithe|kani|mundu|taruvata)\b/gi;

const EVIDENCE_HINTS =
  /\b(latest|current|today|tonight|news|price|stock|weather|who is|release date|2025|2026|recent|now|live|score)\b/i;

const HIGH_RISK = /\b(medical|legal|diagnosis|prescription|invest|lawsuit|suicide|weapon|exploit|malware)\b/i;

/**
 * A greeting, thanks or one-word acknowledgement. These carry no reasoning
 * demand, so spending four model calls (two drafts, a verifier and a fusion) on
 * them is waste. Kept deliberately narrow: a short question is not trivial.
 */
const TRIVIAL =
  /^\s*(?:(?:hi+|hey+|hello+|yo|hola|namaste|namaskaram|gm|gn|హాయ్|నమస్కారం|thanks?|thank you|thx|ok(?:ay)?|kk|cool|nice|great|got it|sure|yes|no|yep|nope|hmm+|👍|🙏|how are you|how'?s it going|what'?s up|who are you)[\s!.,?~]*)+$/i;

export function isTrivialTurn(task: string): boolean {
  const text = (task ?? "").trim();
  if (!text || text.length > 60) return false;
  return TRIVIAL.test(text);
}

export function classify(task: string): Intent {
  const text = task.trim();
  const lower = text.toLowerCase();

  const hasTelugu = TELUGU.test(text);
  const hasLatin = LATIN.test(text);
  const romanMarkers = new Set((text.match(ROMAN_TELUGU) ?? []).map((m) => m.toLowerCase()));
  const language: TaskProfile["language"] =
    hasTelugu && hasLatin
      ? "mixed"
      : hasTelugu
        ? "te"
        : romanMarkers.size >= 2
          ? "mixed"
          : "en";

  let domain: TaskProfile["domain"] = "general";
  let bestHits = 0;
  for (const [name, re] of DOMAIN_HINTS) {
    const hits = (lower.match(new RegExp(re.source, "gi")) ?? []).length;
    if (hits > bestHits) {
      bestHits = hits;
      domain = name;
    }
  }
  // fenced code is the strongest coding signal
  if (/```/.test(text)) domain = "coding";
  // A bare expression ("137 * 29 = ?") is arithmetic even when no keyword is used.
  if (/\d\s*[+\-*/×÷]\s*\d|\d+\s*%/.test(text) && domain === "general") domain = "math";

  const long = text.length > 900;
  const multiPart = (text.match(/[?\n]/g) ?? []).length > 3;
  const complexity: TaskProfile["complexity"] = long || multiPart ? 2 : text.length > 220 ? 1 : 0;

  const needsEvidence = EVIDENCE_HINTS.test(lower) || (domain === "research" && complexity > 0);
  const risk: TaskProfile["risk"] = HIGH_RISK.test(lower) ? "high" : complexity === 2 ? "medium" : "low";

  const rationale = [
    `language=${language}${!hasTelugu && romanMarkers.size >= 2 ? "(romanised)" : ""}`,
    `domain=${domain}`,
    `complexity=${complexity}`,
    needsEvidence ? "evidence-needed" : "no-evidence-needed",
    `risk=${risk}`,
  ].join(" · ");

  return {
    profile: { language, domain, complexity, needsEvidence, risk, tokenBudget: long ? 1400 : 900 },
    task: text,
    rationale,
  };
}
