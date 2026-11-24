/**
 * HYDRO AI — deterministic policy.
 * Permissions, budgets and limits live in code, never in a model. A model can
 * propose a plan; it cannot raise its own spending limit.
 */

import type { Mode } from "@/core/types";

export interface Budget {
  maxCalls: number;
  maxUsd: number;
  usedCalls: number;
  spentUsd: number;
  deadline: number;
}

export interface ModePlan {
  mode: Mode;
  label: string;
  blurb: string;
  drafts: number;
  verify: boolean;
  research: boolean;
  maxRounds: number;
  maxCalls: number;
  maxUsd: number;
  timeoutMs: number;
}

export const MODES: Record<Mode, ModePlan> = {
  flash: {
    mode: "flash",
    label: "Flash",
    blurb: "One model. Lowest latency and cost.",
    drafts: 1,
    verify: false,
    research: false,
    maxRounds: 0,
    maxCalls: 2,
    maxUsd: 0.02,
    timeoutMs: 45_000,
  },
  hybrid: {
    mode: "hybrid",
    label: "Hybrid",
    blurb: "Two independent experts fused into one answer.",
    drafts: 2,
    verify: true,
    research: false,
    maxRounds: 1,
    // 2 drafts + verifier + synthesis leaves no headroom for a retry, which is
    // exactly when a provider 429 used to end the turn. The extra call is a
    // retry slot; the dollar ceiling is unchanged.
    maxCalls: 6,
    maxUsd: 0.06,
    timeoutMs: 75_000,
  },
  deep: {
    mode: "deep",
    label: "Deep",
    blurb: "Experts, retrieved evidence, claim verification and critique.",
    drafts: 2,
    verify: true,
    research: true,
    maxRounds: 2,
    maxCalls: 8,
    maxUsd: 0.14,
    timeoutMs: 120_000,
  },
  council: {
    mode: "council",
    label: "Council",
    blurb: "Every eligible model, then consensus synthesis.",
    drafts: 4,
    verify: true,
    research: true,
    maxRounds: 2,
    maxCalls: 10,
    maxUsd: 0.24,
    timeoutMs: 150_000,
  },
};

/** Hard ceiling regardless of what a client sends. */
export function resolvePlan(mode: string | undefined): ModePlan {
  const key = (mode ?? "hybrid") as Mode;
  return MODES[key] ?? MODES.hybrid;
}

export function createBudget(plan: ModePlan): Budget {
  const envCalls = Number(process.env.HYDRO_MAX_CALLS);
  const envUsd = Number(process.env.HYDRO_BUDGET_USD);
  return {
    maxCalls: Math.min(plan.maxCalls, Number.isFinite(envCalls) ? Math.max(1, envCalls) : plan.maxCalls),
    maxUsd: Math.min(plan.maxUsd, Number.isFinite(envUsd) ? Math.max(0.001, envUsd) : plan.maxUsd),
    usedCalls: 0,
    spentUsd: 0,
    deadline: Date.now() + plan.timeoutMs,
  };
}

/** Atomically reserve one call. Returns false when a hard limit is hit. */
export function reserve(budget: Budget, estimatedUsd: number): boolean {
  if (budget.usedCalls + 1 > budget.maxCalls) return false;
  if (budget.spentUsd + estimatedUsd > budget.maxUsd) return false;
  if (Date.now() > budget.deadline) return false;
  budget.usedCalls += 1;
  budget.spentUsd += estimatedUsd;
  return true;
}

export function remainingMs(budget: Budget): number {
  return Math.max(0, budget.deadline - Date.now());
}

export function estimateCost(inputTokens: number, outputTokens: number, pricePerMTok: number): number {
  return ((inputTokens + outputTokens) / 1_000_000) * pricePerMTok;
}
