#!/usr/bin/env node
/**
 * HYDRO AI — live provider probe.
 * Sends one minimal completion to every configured model so the registry only
 * routes to ids that actually answer. Run with: npm run providers
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SPECS = [
  ["openrouter", "https://openrouter.ai/api/v1/chat/completions", "anthropic/claude-fable-5.2", "OPENROUTER_API_KEY"],
  ["openrouter", "https://openrouter.ai/api/v1/chat/completions", "openai/gpt-6.2-astra", "OPENROUTER_API_KEY"],
  ["openrouter", "https://openrouter.ai/api/v1/chat/completions", "google/gemini-4-hydrogen", "OPENROUTER_API_KEY"],
  ["openrouter", "https://openrouter.ai/api/v1/chat/completions", "qwen/qwen4-max", "OPENROUTER_API_KEY"],
  ["deepseek", "https://api.deepseek.com/chat/completions", "deepseek-v4-pro", "DEEPSEEK_API_KEY"],
  ["deepseek", "https://api.deepseek.com/chat/completions", "deepseek-flash", "DEEPSEEK_API_KEY"],
  ["groq", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b", "GROQ_API_KEY"],
  ["groq", "https://api.groq.com/openai/v1/chat/completions", "qwen/qwen3.8-27b", "GROQ_API_KEY"],
];

const out = [];
for (const [provider, url, model, envKey] of SPECS) {
  const key = env[envKey];
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with the single word: ONLINE" }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const ms = Date.now() - started;
    const body = await res.text();
    let text = "";
    try {
      text = JSON.parse(body).choices?.[0]?.message?.content ?? "";
    } catch {}
    out.push({ model, ok: res.ok && text.trim().length > 0, status: res.status, ms, text: text.trim().slice(0, 40) || body.slice(0, 110) });
  } catch (e) {
    out.push({ model, ok: false, status: 0, ms: Date.now() - started, text: String(e).slice(0, 110) });
  }
}

// Gemini
try {
  const started = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word: ONLINE" }] }] }),
      signal: AbortSignal.timeout(60000),
    },
  );
  const body = await res.text();
  let text = "";
  try {
    text = JSON.parse(body).candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } catch {}
  out.push({ model: "gemini-3.5-flash", ok: res.ok && !!text.trim(), status: res.status, ms: Date.now() - started, text: text.trim().slice(0, 40) || body.slice(0, 110) });
} catch (e) {
  out.push({ model: "gemini-3.5-flash", ok: false, status: 0, ms: 0, text: String(e).slice(0, 110) });
}

console.log("\nHYDRO AI — model reachability probe\n");
for (const r of out) {
  console.log(
    `${r.ok ? "OK  " : "FAIL"}  ${String(r.ms).padStart(6)}ms  ${r.status || "---"}  ${r.model.padEnd(34)} ${r.text.replace(/\s+/g, " ")}`,
  );
}
const good = out.filter((r) => r.ok).length;
console.log(`\n${good}/${out.length} models reachable\n`);
process.exit(good === 0 ? 1 : 0);
