/**
 * HYDRO AI — unified model gateway.
 * Orchestration code never imports a vendor SDK: it asks for a ModelSpec and the
 * gateway picks the right adapter, tracks circuit state and normalises errors.
 */

import { anthropicChat, anthropicHealth } from "@/adapters/anthropic";
import { geminiChat, geminiProbe, geminiStream } from "@/adapters/gemini";
import { breakerOpen, recordFailure, recordSuccess } from "@/adapters/http";
import { apiKeyFor, oaiChat, oaiProbe, oaiStream, type ChatTurn } from "@/adapters/openai";
import { PROVIDER_LABELS } from "@/core/registry";
import type { ModelSpec, ProviderHealth, ProviderId } from "@/core/types";
import type { CallResult } from "@/adapters/http";

export type { ChatTurn };

export async function callModel(
  spec: ModelSpec,
  opts: { messages: ChatTurn[]; maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<CallResult> {
  if (breakerOpen(spec.id)) {
    throw new Error(`${spec.label} is cooling down after repeated failures`);
  }
  try {
    let result: CallResult;
    if (spec.provider === "gemini") {
      result = await geminiChat(spec, opts);
    } else if (spec.provider === "anthropic") {
      result = await anthropicChat(opts);
    } else {
      result = await oaiChat(spec, opts);
    }
    recordSuccess(spec.id);
    return result;
  } catch (err) {
    recordFailure(spec.id);
    throw err;
  }
}

export async function* streamModel(
  spec: ModelSpec,
  opts: { messages: ChatTurn[]; maxTokens?: number; temperature?: number; signal?: AbortSignal },
): AsyncGenerator<string> {
  // Streaming is the last step of a turn, so it must respect the same circuit
  // breaker as an ordinary call: a model that just failed twice is skipped
  // instead of being retried while the user waits.
  if (breakerOpen(spec.id)) {
    throw new Error(`${spec.label} is cooling down after repeated failures`);
  }
  let completed = false;
  try {
    if (spec.provider === "gemini") {
      yield* geminiStream(spec, opts);
    } else {
      yield* oaiStream(spec, opts);
    }
    completed = true;
  } finally {
    if (completed) recordSuccess(spec.id);
    else recordFailure(spec.id);
  }
}

export function configured(spec: ModelSpec): boolean {
  return Boolean(apiKeyFor(spec.provider));
}

/** A cheap model per provider, used only for the health probe. */
const PROBE_MODEL: Partial<Record<ProviderId, string>> = {
  openrouter: "qwen/qwen4-max",
  deepseek: "deepseek-flash",
  groq: "qwen/qwen3.8-27b",
  xai: "grok-4-fast",
};

let healthCache: { at: number; data: ProviderHealth[] } | null = null;
const HEALTH_TTL = 60_000;

export async function providerHealth(force = false): Promise<ProviderHealth[]> {
  if (!force && healthCache && Date.now() - healthCache.at < HEALTH_TTL) {
    return healthCache.data;
  }
  const providers: ProviderId[] = ["openrouter", "deepseek", "groq", "gemini", "anthropic", "xai"];
  const results = await Promise.all(
    providers.map(async (id): Promise<ProviderHealth> => {
      const configuredFlag = Boolean(apiKeyFor(id));
      if (!configuredFlag) {
        return {
          id,
          label: PROVIDER_LABELS[id],
          configured: false,
          online: false,
          latencyMs: null,
          note: "no credential",
        };
      }
      const probe =
        id === "anthropic"
          ? await anthropicHealth()
          : id === "gemini"
            ? await geminiProbe()
            : await oaiProbe(id, PROBE_MODEL[id] ?? "");
      return {
        id,
        label: PROVIDER_LABELS[id],
        configured: true,
        online: probe.ok,
        latencyMs: probe.latencyMs,
        note: probe.note,
      };
    }),
  );
  healthCache = { at: Date.now(), data: results };
  return results;
}

/** Model ids that are usable right now. */
export async function availableModelIds(): Promise<Set<string>> {
  const health = await providerHealth();
  const online = new Set(health.filter((h) => h.online).map((h) => h.id));
  return online;
}
