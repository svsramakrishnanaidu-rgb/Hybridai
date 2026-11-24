/**
 * HYDRO AI — OpenAI-compatible adapter.
 * One implementation serves OpenRouter, DeepSeek, Groq and xAI because they all
 * expose the /chat/completions contract.
 */

import { fetchJson, sseLines, ProviderError, type CallResult } from "@/adapters/http";
import type { ModelSpec, ProviderId } from "@/core/types";

const BASES: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
};

export function apiKeyFor(provider: ProviderId): string | undefined {
  const map: Partial<Record<ProviderId, string | undefined>> = {
    openrouter: process.env.OPENROUTER_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    xai: process.env.XAI_API_KEY,
  };
  const key = map[provider];
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

function headers(provider: ProviderId): Record<string, string> {
  const key = apiKeyFor(provider)!;
  const h: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
  };
  if (provider === "openrouter") {
    h["http-referer"] = "http://localhost:3000";
    h["x-title"] = "HYDRO AI";
  }
  return h;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallOptions {
  messages: ChatTurn[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface OAIChoice {
  message?: { content?: string | null; reasoning?: string | null };
  finish_reason?: string | null;
}

interface OAIResponse {
  choices?: OAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export async function oaiChat(spec: ModelSpec, opts: CallOptions): Promise<CallResult> {
  const started = Date.now();
  let budget = opts.maxTokens ?? 1200;

  // Reasoning models can spend the whole budget thinking and return no content.
  // That is not a provider failure, so retry once with a larger budget.
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await fetchJson<OAIResponse>(`${BASES[spec.provider]}/chat/completions`, {
      method: "POST",
      headers: headers(spec.provider),
      provider: spec.provider,
      timeoutMs: opts.timeoutMs ?? 60_000,
      signal: opts.signal,
      body: JSON.stringify({
        model: spec.model,
        messages: opts.messages,
        max_tokens: budget,
        temperature: opts.temperature ?? 0.4,
        stream: false,
      }),
    });
    if (data.error?.message) {
      throw new ProviderError(data.error.message, spec.provider);
    }

    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (text.trim()) {
      return {
        text,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - started,
      };
    }

    const reasoningOnly =
      Boolean(choice?.message?.reasoning) || choice?.finish_reason === "length";
    if (!reasoningOnly) break;
    budget = Math.min(budget * 3, 4096);
  }

  throw new ProviderError(`${spec.provider} returned an empty completion`, spec.provider);
}

/** Stream tokens for the final answer. Yields text deltas. */
export async function* oaiStream(
  spec: ModelSpec,
  opts: CallOptions,
): AsyncGenerator<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${BASES[spec.provider]}/chat/completions`, {
      method: "POST",
      headers: headers(spec.provider),
      signal: ctrl.signal,
      body: JSON.stringify({
        model: spec.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 1600,
        temperature: opts.temperature ?? 0.6,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new ProviderError(
        `${spec.provider} stream failed ${res.status}: ${body.slice(0, 200)}`,
        spec.provider,
        res.status,
      );
    }
    for await (const payload of sseLines(res.body, ctrl.signal)) {
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore keep-alive or malformed frames
      }
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export function describeStatus(status: number, body: string): string {
  const text = body.toLowerCase();
  if (text.includes("insufficient balance")) return "insufficient balance";
  if (text.includes("requires more credits") || text.includes("can only afford"))
    return "low credit balance";
  if (status === 402) return "no credit balance";
  if (status === 401 || status === 403) return "invalid credentials";
  if (status === 429) return "rate limited";
  if (status >= 500) return "provider unavailable";
  return `HTTP ${status}`;
}

/**
 * Health probe with a real (4-token) inference call. Metadata endpoints lie:
 * a provider with no balance still returns 200 from /models.
 */
export async function oaiProbe(
  provider: ProviderId,
  model: string,
): Promise<{ ok: boolean; note: string | null; latencyMs: number }> {
  const key = apiKeyFor(provider);
  if (!key) return { ok: false, note: "no key configured", latencyMs: 0 };
  const started = Date.now();
  try {
    const res = await fetch(`${BASES[provider]}/chat/completions`, {
      method: "POST",
      headers: headers(provider),
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model,
        max_tokens: 4,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    const latencyMs = Date.now() - started;
    if (res.ok) return { ok: true, note: null, latencyMs };
    const body = await res.text().catch(() => "");
    return { ok: false, note: describeStatus(res.status, body), latencyMs };
  } catch (err) {
    return {
      ok: false,
      note: err instanceof Error ? err.message.slice(0, 90) : "unreachable",
      latencyMs: Date.now() - started,
    };
  }
}

/** Cheap metadata ping used for provider health. */
export async function oaiModels(provider: ProviderId): Promise<{ ok: boolean; note: string | null }> {
  const key = apiKeyFor(provider);
  if (!key) return { ok: false, note: "no key configured" };
  try {
    const res = await fetch(`${BASES[provider]}/models`, {
      headers: headers(provider),
      signal: AbortSignal.timeout(12_000),
    });
    return { ok: res.ok, note: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message : "unreachable" };
  }
}
