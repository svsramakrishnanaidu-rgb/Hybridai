/**
 * HYDRO AI — claim graph.
 *
 * Claims are extracted mechanically from drafts, then labelled by how much
 * independent support they actually have:
 *   verified     — supported by a retrieved source
 *   corroborated — asserted independently by two or more drafts
 *   unverified   — asserted once, no source
 * A claim never becomes "verified" because a model sounded confident.
 */

import type { Claim, Evidence } from "@/core/types";
import { uid } from "./util.ts";

const STOP = new Set(
  "the a an and or but if then that this these those is are was were be been being to of in on for with as at by from it its it's you your we our they their he she i not no so than too very can could should would may might will just also more most such into over under about".split(
    " ",
  ),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[^a-z0-9\u0C00-\u0C7F\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Polarity of a sentence. Word overlap alone cannot tell "X supports Y" from
 * "X does not support Y" — negation is a stopword — so two drafts that assert
 * the opposite of each other used to be counted as corroboration. Those are now
 * kept as separate claims and cross-linked as a contradiction.
 */
const NEGATION = /\b(?:not|never|no|cannot|can't|won't|isn't|aren't|doesn't|don't|n't)\b/i;

function negated(sentence: string): boolean {
  return NEGATION.test(sentence);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** Split a draft into candidate declarative sentences worth tracking. */
function sentences(draft: string): string[] {
  return draft
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}.*$/gm, " ")
    .replace(/\[[0-9]+\]/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((s) => s.length >= 35 && s.length <= 240)
    .filter((s) => !/^(here|sure|certainly|of course|let me|i can|would you)/i.test(s));
}

export interface ClaimGraphInput {
  drafts: Array<{ modelId: string; text: string }>;
  evidence: Evidence[];
}

export function buildClaimGraph({ drafts, evidence }: ClaimGraphInput): Claim[] {
  const perDraft = drafts.map((d) => ({ ...d, items: sentences(d.text).slice(0, 12) }));
  const claims: Claim[] = [];

  for (let i = 0; i < perDraft.length; i++) {
    for (const sentence of perDraft[i].items) {
      const tokens = words(sentence);
      if (tokens.length < 4) continue;

      const polarity = negated(sentence);

      // Merge into an existing claim only when the meaning agrees. A sentence
      // with the opposite polarity is a contradiction, not extra support.
      const existing = claims.find(
        (c) => negated(c.text) === polarity && jaccard(words(c.text), tokens) > 0.55,
      );
      if (existing) {
        existing.support += 1;
        if (existing.status === "unverified" && existing.support >= 2) {
          existing.status = "corroborated";
        }
        continue;
      }

      const support = perDraft.reduce((acc, d, idx) => {
        if (idx === i) return acc;
        const agree = d.items.some(
          (s) => negated(s) === polarity && jaccard(words(s), tokens) > 0.42,
        );
        return acc + (agree ? 1 : 0);
      }, 1);

      const evidenceIds = evidence
        .filter((e) => jaccard(words(e.snippet), tokens) > 0.3)
        .map((e) => e.id);

      const id = uid("c");
      const contradicts: string[] = [];
      for (const c of claims) {
        if (negated(c.text) !== polarity && jaccard(words(c.text), tokens) > 0.5) {
          contradicts.push(c.id);
          // link both directions so the ledger flags either side of the conflict
          c.contradicts = [...c.contradicts, id];
        }
      }

      claims.push({
        id,
        text: sentence,
        support,
        contradicts,
        status: evidenceIds.length
          ? "verified"
          : support >= 2 && !contradicts.length
            ? "corroborated"
            : "unverified",
        evidenceIds,
      });
    }
  }

  return claims
    .sort((a, b) => {
      const rank = { verified: 2, corroborated: 1, unverified: 0 } as const;
      return rank[b.status] - rank[a.status] || b.support - a.support;
    })
    .slice(0, 10);
}

export function claimSummary(claims: Claim[], evidence: Evidence[]): string {
  if (!claims.length) return "";
  const lines = claims.map((c) => {
    const tag =
      c.status === "verified"
        ? "SOURCE-BACKED"
        : c.status === "corroborated"
          ? "INDEPENDENTLY CORROBORATED"
          : "SINGLE-DRAFT / UNVERIFIED";
    const conflict = c.contradicts.length ? " · CONFLICTS WITH ANOTHER CLAIM" : "";
    return `- [${tag}${conflict}] ${c.text}`;
  });
  const src = evidence.length
    ? `\n\nSources available:\n${evidence.map((e, i) => `[${i + 1}] ${e.title} — ${e.url}`).join("\n")}`
    : "";
  return `\n\nCLAIM LEDGER (from independent drafts):\n${lines.join("\n")}${src}`;
}
