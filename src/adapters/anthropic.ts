/**
 * HYDRO AI — Anthropic adapter (direct Messages API).
 * Present for completeness and health reporting; the supplied account has no
 * credit balance, so the UI shows it as configured-but-unavailable.
 */

import { fetchJson, ProviderError, type CallResult } from "@/adapters/http";
import type { ChatTurn } from "@/adapters/openai";
import { ANTHROPIC_MODEL } from "@/core/registry";

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

export async function anthropicChat(opts: {
  messages: ChatTurn[];
  maxTokens?: number;
  temperature?: number;
}): Promise<CallResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new ProviderError("Anthropic key missing", "anthropic");
  const started = Date.now();
  const system = opts.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const data = await fetchJson<AnthropicResponse>("https://api.anthropic.com/v1/messages", {
    method: "POST",
    provider: "anthropic",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 1200,
      temperature: opts.temperature ?? 0.4,
      ...(system ? { system } : {}),
      messages: opts.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (data.error?.message) throw new ProviderError(data.error.message, "anthropic");
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  if (!text.trim()) throw new ProviderError("Anthropic returned an empty completion", "anthropic");
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}

export async function anthropicHealth(): Promise<{
  ok: boolean;
  note: string | null;
  latencyMs: number;
}> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { ok: false, note: "no key configured", latencyMs: 0 };
  const started = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - started;
    if (res.ok) return { ok: true, note: null, latencyMs };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    return {
      ok: false,
      note: /credit balance/i.test(msg) ? "no credit balance" : msg.slice(0, 110),
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      note: err instanceof Error ? err.message : "unreachable",
      latencyMs: Date.now() - started,
    };
  }
}
