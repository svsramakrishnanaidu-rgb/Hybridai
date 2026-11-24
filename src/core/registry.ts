/**
 * HYDRO AI — provider registry.
 *
 * Every model is an interchangeable adapter. The registry is data, not behaviour:
 * routing priors and ids change without touching orchestration code.
 * Reachability of each id was verified against the live provider APIs at build
 * time (`npm run providers`). DeepSeek is registered but currently unfunded, so
 * the health probe marks it unavailable instead of the router guessing.
 */

import type { ModelSpec, ProviderId } from "@/core/types";

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  groq: "Groq",
  gemini: "Google Gemini",
  anthropic: "Anthropic",
  xai: "xAI",
};

export const MODELS: ModelSpec[] = [
  {
    id: "openrouter:anthropic/claude-fable-5.2",
    provider: "openrouter",
    model: "anthropic/claude-fable-5.2",
    label: "Claude Fable 5.2",
    strengths: ["writing", "analysis", "general", "coding"],
    accuracyPrior: 0.93,
    pricePerMTok: 9,
    latencyPrior: 3200,
    contextWindow: 200000,
  },
  {
    id: "openrouter:openai/gpt-6.2-astra",
    provider: "openrouter",
    model: "openai/gpt-6.2-astra",
    label: "GPT-6.2 Astra",
    strengths: ["coding", "math", "analysis", "general"],
    accuracyPrior: 0.94,
    pricePerMTok: 8,
    latencyPrior: 2900,
    contextWindow: 400000,
  },
  {
    id: "openrouter:google/gemini-4-hydrogen",
    provider: "openrouter",
    model: "google/gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    strengths: ["research", "analysis", "general", "writing"],
    accuracyPrior: 0.9,
    pricePerMTok: 4,
    latencyPrior: 2400,
    contextWindow: 1000000,
  },
  {
    id: "openrouter:qwen/qwen4-max",
    provider: "openrouter",
    model: "qwen/qwen4-max",
    label: "Qwen4 Max",
    strengths: ["coding", "math", "general"],
    accuracyPrior: 0.87,
    pricePerMTok: 3,
    latencyPrior: 2200,
    contextWindow: 262000,
  },
  {
    id: "gemini:gemini-3.5-flash-lite",
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    strengths: ["general", "research", "writing", "math"],
    accuracyPrior: 0.88,
    pricePerMTok: 0.1,
    latencyPrior: 1500,
    contextWindow: 1000000,
  },
  {
    id: "gemini:gemini-3-flash-preview",
    provider: "gemini",
    model: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    strengths: ["research", "analysis", "general"],
    accuracyPrior: 0.86,
    pricePerMTok: 0.3,
    latencyPrior: 1900,
    contextWindow: 1000000,
  },
  {
    id: "groq:openai/gpt-oss-120b",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    strengths: ["general", "analysis", "math", "coding"],
    accuracyPrior: 0.84,
    pricePerMTok: 0.2,
    latencyPrior: 900,
    contextWindow: 131072,
  },
  {
    id: "groq:qwen/qwen3.8-27b",
    provider: "groq",
    model: "qwen/qwen3.8-27b",
    label: "Qwen3.8 27B",
    strengths: ["general", "coding", "writing"],
    accuracyPrior: 0.8,
    pricePerMTok: 0.12,
    latencyPrior: 700,
    contextWindow: 131072,
  },
  {
    id: "deepseek:deepseek-v4-pro",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    strengths: ["coding", "math", "analysis"],
    accuracyPrior: 0.9,
    pricePerMTok: 0.6,
    latencyPrior: 3400,
    contextWindow: 1048576,
  },
  {
    id: "deepseek:deepseek-flash",
    provider: "deepseek",
    model: "deepseek-flash",
    label: "DeepSeek Flash",
    strengths: ["general", "coding", "writing"],
    accuracyPrior: 0.82,
    pricePerMTok: 0.15,
    latencyPrior: 1200,
    contextWindow: 1048576,
  },
];

export const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

export function getModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}

export function modelsFor(provider: ProviderId): ModelSpec[] {
  return MODELS.filter((m) => m.provider === provider);
}
