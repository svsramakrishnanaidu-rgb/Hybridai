/**
 * HYDRO AI — Google Gemini adapter (native generateContent API).
 * Gemini is addressed directly rather than through the aggregator so its
 * availability is independent of OpenRouter.
 */

import { fetchJson, sseLines, ProviderError, type CallResult } from "@/adapters/http";
import type { ChatTurn } from "@/adapters/openai";
import type { ModelSpec } from "@/core/types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

function toBody(opts: { messages: ChatTurn[]; maxTokens?: number; temperature?: number }) {
  const systemParts = opts.messages.filter((m) => m.role === "system").map((m) => m.content);
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  return {
    contents,
    ...(systemParts.length
      ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } }
      : {}),
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 1200,
      temperature: opts.temperature ?? 0.4,
    },
  };
}

export async function geminiChat(
  spec: ModelSpec,
  opts: { messages: ChatTurn[]; maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<CallResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new ProviderError("Gemini key missing", "gemini");
  const started = Date.now();
  const data = await fetchJson<GeminiResponse>(
    `${BASE}/${spec.model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      provider: "gemini",
      timeoutMs: opts.timeoutMs ?? 45_000,
      body: JSON.stringify(toBody(opts)),
    },
  );
  if (data.error?.message) throw new ProviderError(data.error.message, "gemini");
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new ProviderError("Gemini returned an empty completion", "gemini");
  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    latencyMs: Date.now() - started,
  };
}

export async function* geminiStream(
  spec: ModelSpec,
  opts: { messages: ChatTurn[]; maxTokens?: number; temperature?: number; signal?: AbortSignal },
): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new ProviderError("Gemini key missing", "gemini");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(
      `${BASE}/${spec.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify(toBody(opts)),
      },
    );
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new ProviderError(`Gemini stream failed ${res.status}: ${body.slice(0, 200)}`, "gemini");
    }
    for await (const payload of sseLines(res.body, ctrl.signal)) {
      try {
        const json = JSON.parse(payload) as GeminiResponse;
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
        if (text) yield text;
      } catch {
        // ignore partial frames
      }
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Health probe with a real inference call so quota problems are visible. */
export async function geminiProbe(
  model = "gemini-3.5-flash-lite",
): Promise<{ ok: boolean; note: string | null; latencyMs: number }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, note: "no key configured", latencyMs: 0 };
  const started = Date.now();
  try {
    const res = await fetch(
      `${BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 4 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const latencyMs = Date.now() - started;
    if (res.ok) return { ok: true, note: null, latencyMs };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    return {
      ok: false,
      note: /high demand|UNAVAILABLE/i.test(msg)
        ? "model overloaded"
        : res.status === 429
          ? "rate limited"
          : msg.slice(0, 90),
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      note: err instanceof Error ? err.message.slice(0, 90) : "unreachable",
      latencyMs: Date.now() - started,
    };
  }
}

export async function geminiHealth(): Promise<{ ok: boolean; note: string | null }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, note: "no key configured" };
  try {
    const res = await fetch(`${BASE}?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(12_000),
    });
    return { ok: res.ok, note: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message : "unreachable" };
  }
}
