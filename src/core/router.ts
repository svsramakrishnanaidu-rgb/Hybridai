/**
 * HYDRO AI — model selection.
 * Implements the blueprint scoring function:
 *   S(i) = 0.30A + 0.25D + 0.20R + 0.10U + 0.10V + 0.05E
 * A accuracy · D domain fit · R measured reliability · U availability · V speed · E cost
 *
 * Reliability uses the Beta (successes+1)/(n+2) posterior once a model has a
 * minimum sample, and falls back to the curated prior before that.
 */

import { MODELS } from "@/core/registry";
import type { ModelSpec, ProviderId, TaskProfile } from "@/core/types";
import { clamp } from "@/core/util";

export interface ReliabilityStat {
  success: number;
  fail: number;
  /** exponentially weighted mean of observed latency, milliseconds */
  latencyMs?: number;
}

export interface ScoreBreakdown {
  spec: ModelSpec;
  score: number;
  A: number;
  D: number;
  R: number;
  U: number;
  V: number;
  E: number;
}

export interface RoutingContext {
  online: Set<ProviderId>;
  stats: Record<string, ReliabilityStat>;
  /** reliability penalty in [0,1] applied by an approved evolution proposal */
  bias: Record<string, number>;
}

const W = { A: 0.3, D: 0.25, R: 0.2, U: 0.1, V: 0.1, E: 0.05 };

export function reliabilityFor(spec: ModelSpec, stats: Record<string, ReliabilityStat>): number {
  const s = stats[spec.id];
  const n = (s?.success ?? 0) + (s?.fail ?? 0);
  if (!s || n < 3) return spec.accuracyPrior;
  return (s.success + 1) / (n + 2);
}

/** Measured latency once enough calls exist, otherwise the curated prior. */
export function speedFor(spec: ModelSpec, stats: Record<string, ReliabilityStat>): number {
  const s = stats[spec.id];
  const n = (s?.success ?? 0) + (s?.fail ?? 0);
  if (s?.latencyMs && n >= 3) return s.latencyMs;
  return spec.latencyPrior;
}

export function scoreModel(spec: ModelSpec, profile: TaskProfile, ctx: RoutingContext): ScoreBreakdown {
  const A = spec.accuracyPrior;
  const D = spec.strengths.includes(profile.domain) ? 1 : profile.domain === "general" ? 0.85 : 0.6;
  const R = clamp(reliabilityFor(spec, ctx.stats));
  const U = ctx.online.has(spec.provider) ? 1 : 0;
  const V = clamp(1 - speedFor(spec, ctx.stats) / 12_000);
  const E = clamp(1 - spec.pricePerMTok / 10);
  const bias = ctx.bias[spec.id] ?? 1;
  const raw = W.A * A + W.D * D + W.R * R + W.U * U + W.V * V + W.E * E;
  return { spec, score: raw * bias, A, D, R, U, V, E };
}

export function rankModels(profile: TaskProfile, ctx: RoutingContext): ScoreBreakdown[] {
  return MODELS.map((m) => scoreModel(m, profile, ctx))
    .filter((s) => s.U > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Choose a complementary team. Picking the two highest scores is not enough —
 * two models from the same vendor share failure modes, so the second expert is
 * preferred from a different provider or with different strengths.
 */
export function chooseTeam(
  profile: TaskProfile,
  ctx: RoutingContext,
  size: number,
  exclude: string[] = [],
): ScoreBreakdown[] {
  const ranked = rankModels(profile, ctx).filter((s) => !exclude.includes(s.spec.id));
  if (!ranked.length) return [];
  const team = [ranked[0]];
  while (team.length < size) {
    let best: ScoreBreakdown | null = null;
    let bestValue = -Infinity;
    for (const cand of ranked) {
      if (team.some((t) => t.spec.id === cand.spec.id)) continue;
      const independent = team.every((t) => t.spec.provider !== cand.spec.provider) ? 0.06 : 0;
      const diverse = team.every(
        (t) => t.spec.strengths[0] !== cand.spec.strengths[0],
      )
        ? 0.03
        : 0;
      const value = cand.score + independent + diverse;
      if (value > bestValue) {
        bestValue = value;
        best = cand;
      }
    }
    if (!best) break;
    team.push(best);
  }
  return team;
}

/**
 * Primary model for a single-shot answer.
 *
 * Flash mode is cost-first, but a reasoning turn on the cheapest small model
 * produced a visibly wrong answer (weekday arithmetic). For math, analysis and
 * any non-trivial turn the primary must clear a quality floor; routing then
 * stays cheap, because one call on a stronger model is still a fraction of a
 * multi-model draft.
 */
export function choosePrimary(
  profile: TaskProfile,
  ctx: RoutingContext,
  minAccuracy = 0.86,
): ScoreBreakdown | null {
  const ranked = rankModels(profile, ctx);
  if (!ranked.length) return null;
  const reasoning =
    profile.domain === "math" || profile.domain === "analysis" || profile.complexity >= 1;
  if (reasoning) {
    const strong = ranked.filter((r) => r.spec.accuracyPrior >= minAccuracy);
    if (strong.length) return strong[0];
  }
  return ranked[0];
}

/** Cheapest fast model for mechanical subtasks (critique, claim handling). */
export function chooseUtility(
  profile: TaskProfile,
  ctx: RoutingContext,
  exclude: string[] = [],
): ScoreBreakdown | null {
  const ranked = rankModels(profile, ctx).filter((s) => !exclude.includes(s.spec.id));
  const fast = [...ranked].sort(
    (a, b) => b.V * 0.6 + b.E * 0.4 - (a.V * 0.6 + a.E * 0.4),
  );
  return fast[0] ?? null;
}
