#!/usr/bin/env node
/**
 * HYDRO AI — end-to-end orchestrator self test.
 * Drives the live /api/chat stream so the whole pipeline is exercised against
 * real providers: routing, drafts, verification, fusion and SSE transport.
 *
 *   node scripts/selftest.mjs "your question" [mode]
 */
const question = process.argv[2] ?? "In one short paragraph, what is a hash table?";
const mode = process.argv[3] ?? "hybrid";
const base = process.env.HYDRO_BASE ?? "http://localhost:3000";

const started = Date.now();
const res = await fetch(`${base}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode, messages: [{ role: "user", content: question }] }),
});

if (!res.ok || !res.body) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let answer = "";
let meta = null;
let failed = false;
const traces = [];

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let at = buffer.indexOf("\n\n");
  while (at !== -1) {
    const chunk = buffer.slice(0, at);
    buffer = buffer.slice(at + 2);
    at = buffer.indexOf("\n\n");
    const line = chunk.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (event.kind === "trace") {
      traces.push(event);
      console.log(`  [${event.phase.padEnd(9)}] ${event.detail}`);
    } else if (event.kind === "token") {
      answer += event.text;
    } else if (event.kind === "meta") {
      meta = event;
    } else if (event.kind === "error") {
      failed = true;
      console.error(`  ERROR: ${event.message}`);
    }
  }
}

console.log("\n──────── ANSWER ────────");
console.log(answer.trim() || "(empty)");

if (meta) {
  console.log("\n──────── RUN ────────");
  console.log(`mode=${meta.mode} calls=${meta.calls} cost=$${meta.costUsd.toFixed(4)} latency=${(
    meta.latencyMs / 1000
  ).toFixed(1)}s streamed=${meta.streamed} degraded=${meta.degraded}`);
  console.log(
    `agents: ${meta.agents.map((a) => `${a.label}=${a.status}${a.latencyMs ? `(${a.latencyMs}ms)` : ""}`).join(", ")}`,
  );
  console.log(
    `claims: ${meta.claims.length} — ${meta.claims.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {}) && JSON.stringify(meta.claims.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {}))}`,
  );
  if (meta.evidence.length) console.log(`evidence: ${meta.evidence.map((e) => e.title).join(" | ")}`);
  if (meta.notice) console.log(`notice: ${meta.notice}`);
}

console.log(`\ntotal wall time ${((Date.now() - started) / 1000).toFixed(1)}s`);
const ok = Boolean(answer.trim()) && !failed && meta !== null;
console.log(ok ? "SELFTEST PASS" : "SELFTEST FAIL");
process.exit(ok ? 0 : 1);
