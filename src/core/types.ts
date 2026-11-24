/**
 * HYDRO AI — shared protocol types.
 * These mirror the structured agent message schema in the HYDRO blueprint (§09).
 */

export type Mode = "flash" | "hybrid" | "deep" | "council";

export type AgentRole =
  | "planner"
  | "researcher"
  | "drafter"
  | "critic"
  | "verifier"
  | "fusion";

export type AgentStatus = "queued" | "running" | "complete" | "failed" | "skipped";

/** A normalized proposition extracted from a draft. */
export interface Claim {
  id: string;
  text: string;
  /** number of independent drafts that asserted it */
  support: number;
  contradicts: string[];
  status: "verified" | "corroborated" | "unverified";
  evidenceIds: string[];
}

export interface Evidence {
  id: string;
  title: string;
  url: string;
  snippet: string;
  retrievedAt: string;
}

export interface AgentRun {
  id: string;
  role: AgentRole;
  provider: string;
  model: string;
  label: string;
  status: AgentStatus;
  latencyMs: number | null;
  tokens: number | null;
  costUsd: number | null;
  note?: string;
}

export interface TraceEvent {
  kind: "trace";
  step: string;
  phase:
    | "classify"
    | "plan"
    | "research"
    | "draft"
    | "verify"
    | "debate"
    | "fuse"
    | "learn";
  status: "start" | "done" | "info" | "error";
  detail: string;
  agentId?: string;
}

export interface MetaEvent {
  kind: "meta";
  requestId: string;
  mode: Mode;
  streamed: boolean;
  answer: string;
  agents: AgentRun[];
  claims: Claim[];
  evidence: Evidence[];
  calls: number;
  costUsd: number;
  latencyMs: number;
  degraded: boolean;
  notice: string | null;
}

export type StreamEvent =
  | TraceEvent
  | { kind: "token"; text: string }
  | MetaEvent
  | { kind: "error"; message: string };

export interface TaskProfile {
  language: "en" | "te" | "mixed";
  domain: "coding" | "math" | "research" | "writing" | "analysis" | "general";
  complexity: 0 | 1 | 2;
  needsEvidence: boolean;
  risk: "low" | "medium" | "high";
  tokenBudget: number;
}

export interface Intent {
  profile: TaskProfile;
  task: string;
  rationale: string;
}

export interface ModelSpec {
  /** stable id: provider:model */
  id: string;
  provider: ProviderId;
  model: string;
  label: string;
  strengths: Array<TaskProfile["domain"]>;
  /** curated accuracy prior in [0,1] */
  accuracyPrior: number;
  /** USD per 1M blended tokens, curated estimate */
  pricePerMTok: number;
  /** typical latency prior in ms */
  latencyPrior: number;
  contextWindow: number;
}

export type ProviderId =
  | "openrouter"
  | "deepseek"
  | "groq"
  | "gemini"
  | "anthropic"
  | "xai";

export interface ProviderHealth {
  id: ProviderId;
  label: string;
  configured: boolean;
  online: boolean;
  latencyMs: number | null;
  note: string | null;
}
