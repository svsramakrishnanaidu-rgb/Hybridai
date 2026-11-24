import { providerHealth } from "@/adapters";
import { speechCapabilities } from "@/adapters/speech";
import { readStore } from "@/core/memory";
import { MODELS, PROVIDER_LABELS } from "@/core/registry";
import { reliabilityFor, scoreModel, type RoutingContext } from "@/core/router";
import { classify } from "@/core/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [health, store] = await Promise.all([providerHealth(), readStore()]);
  const online = new Set(health.filter((h) => h.online).map((h) => h.id));
  // Score against a neutral profile so the panel shows a comparable baseline.
  const ctx: RoutingContext = { online, stats: store.stats, bias: store.bias };
  const neutral = classify("general question").profile;

  const models = MODELS.map((spec) => {
    const breakdown = scoreModel(spec, neutral, ctx);
    const stat = store.stats[spec.id];
    const n = (stat?.success ?? 0) + (stat?.fail ?? 0);
    return {
      id: spec.id,
      label: spec.label,
      provider: spec.provider,
      providerLabel: PROVIDER_LABELS[spec.provider],
      online: online.has(spec.provider),
      score: Number(breakdown.score.toFixed(4)),
      reliability: Number(reliabilityFor(spec, store.stats).toFixed(3)),
      samples: n,
      failures: stat?.fail ?? 0,
      pricePerMTok: spec.pricePerMTok,
      latencyPrior: spec.latencyPrior,
      strengths: spec.strengths,
    };
  }).sort((a, b) => b.score - a.score);

  return Response.json(
    {
      providers: health,
      models,
      capabilities: {
        ...speechCapabilities(),
        search: Boolean(process.env.TAVILY_API_KEY?.trim()),
      },
      usage: store.usage,
      system: {
        memoryRecords: store.memory.filter((m) => m.status === "active").length,
        proposals: store.proposals.filter((p) => p.status === "proposed").length,
        memoryEnabled: store.settings.memoryEnabled,
        samples: Object.values(store.stats).reduce((n, s) => n + s.success + s.fail, 0),
        failures: Object.values(store.stats).reduce((n, s) => n + s.fail, 0),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
