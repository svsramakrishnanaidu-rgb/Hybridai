/**
 * HYDRO AI — HTTP foundation for provider adapters.
 * Timeouts, one retry on transient failure, and a per-model circuit breaker so a
 * dead provider degrades routing instead of stalling every request.
 */

export interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  raw?: unknown;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

interface Breaker {
  fails: number;
  openUntil: number;
}

const breakers = new Map<string, Breaker>();
const FAIL_THRESHOLD = 2;
const COOLDOWN_MS = 45_000;

export function breakerOpen(key: string): boolean {
  const b = breakers.get(key);
  if (!b) return false;
  if (b.openUntil > Date.now()) return true;
  // cooldown elapsed — allow one probe
  breakers.delete(key);
  return false;
}

export function recordSuccess(key: string): void {
  breakers.delete(key);
}

export function recordFailure(key: string): void {
  const b = breakers.get(key) ?? { fails: 0, openUntil: 0 };
  b.fails += 1;
  if (b.fails >= FAIL_THRESHOLD) {
    b.openUntil = Date.now() + COOLDOWN_MS;
    b.fails = 0;
  }
  breakers.set(key, b);
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; provider: string },
): Promise<T> {
  const { timeoutMs = 45_000, provider, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500;
        throw new ProviderError(
          `${provider} returned ${res.status}: ${body.slice(0, 240)}`,
          provider,
          res.status,
          retryable,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof ProviderError
          ? err.retryable
          : err instanceof Error && err.name === "AbortError";
      if (!retryable || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new ProviderError(`${provider} request failed`, provider);
}

/** Read an SSE body and yield each `data:` payload that is valid JSON. */
export async function* sseLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        yield payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
