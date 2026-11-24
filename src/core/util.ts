/** Small helpers shared by the server-side intelligence core. */

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

export function clamp(n: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, n));
}

export function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Rough token estimate: ~4 chars per token for English, denser for code. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Normalize an incoming chat history, keeping the most recent turns. */
export function trimHistory<T extends { content: string }>(items: T[], maxChars: number): T[] {
  const out: T[] = [];
  let total = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const size = items[i].content.length;
    if (total + size > maxChars) break;
    total += size;
    out.unshift(items[i]);
  }
  return out;
}
