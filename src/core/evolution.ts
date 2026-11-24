/**
 * HYDRO AI — controlled evolution (HYDRO EVOLUTION).
 *
 * The system may read its own telemetry and propose a change. It may never apply
 * one. Every proposal is derived from stored observations, requires an explicit
 * human approval, is reversible, and is written to the audit log.
 *
 * Deliberately absent: code generation, self-deployment, permission changes,
 * credential access. Those are outside what this module can express.
 */

import type { Proposal, Store } from "@/core/memory";
import { MODELS } from "@/core/registry";
import { uid } from "@/core/util";

const MIN_SAMPLE = 4;
const FAIL_CEILING = 0.3;

export function deriveProposals(store: Store): Proposal[] {
  const findings: Proposal[] = [];

  for (const spec of MODELS) {
    const stat = store.stats[spec.id];
    if (!stat) continue;
    const n = stat.success + stat.fail;
    if (n < MIN_SAMPLE) continue;
    const failRate = stat.fail / n;
    if (failRate <= FAIL_CEILING) continue;

    const factor = Math.max(0.4, 1 - failRate);
    const title = `Reduce routing weight for ${spec.label}`;
    if (store.proposals.some((p) => p.title === title && p.status === "proposed")) continue;

    findings.push({
      id: uid("prop"),
      createdAt: new Date().toISOString(),
      title,
      rationale: `Observed failure rate ${(failRate * 100).toFixed(0)}% across ${n} calls, above the ${(
        FAIL_CEILING * 100
      ).toFixed(0)}% ceiling. Down-weighting keeps requests on healthier models.`,
      evidence: `${stat.fail} failures / ${n} recorded calls for ${spec.id}`,
      target: { kind: "model_bias", modelId: spec.id, factor: Number(factor.toFixed(2)) },
      status: "proposed",
      appliedAt: null,
    });
  }

  const totalCalls = store.usage.calls;
  if (totalCalls >= MIN_SAMPLE * 2 && findings.length === 0) {
    const healthy = Object.entries(store.stats).filter(([, s]) => {
      const n = s.success + s.fail;
      return n >= MIN_SAMPLE && s.fail / n <= FAIL_CEILING;
    });
    if (healthy.length) {
      const title = "Routing is within tolerance";
      if (!store.proposals.some((p) => p.title === title)) {
        findings.push({
          id: uid("prop"),
          createdAt: new Date().toISOString(),
          title,
          rationale:
            "Every model with a sufficient sample is inside the failure ceiling, so no routing change is proposed. Recorded as evidence that the controller was evaluated, not as a capability claim.",
          evidence: `${totalCalls} calls · ${healthy.length} models within tolerance`,
          target: { kind: "noop" },
          status: "proposed",
          appliedAt: null,
        });
      }
    }
  }

  return findings;
}

export function approve(store: Store, proposalId: string): Proposal | null {
  const proposal = store.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== "proposed") return null;
  proposal.status = "approved";
  proposal.appliedAt = new Date().toISOString();
  if (proposal.target.kind === "model_bias") {
    store.bias[proposal.target.modelId] = proposal.target.factor;
  }
  store.audit.unshift({
    at: new Date().toISOString(),
    action: "proposal.approved",
    detail: `${proposal.title} (${proposal.id})`,
  });
  store.audit = store.audit.slice(0, 200);
  return proposal;
}

export function reject(store: Store, proposalId: string): Proposal | null {
  const proposal = store.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== "proposed") return null;
  proposal.status = "rejected";
  store.audit.unshift({
    at: new Date().toISOString(),
    action: "proposal.rejected",
    detail: `${proposal.title} (${proposal.id})`,
  });
  store.audit = store.audit.slice(0, 200);
  return proposal;
}

/** Roll back an applied bias — the reversal path the blueprint requires. */
export function rollback(store: Store, proposalId: string): Proposal | null {
  const proposal = store.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== "approved") return null;
  proposal.status = "rejected";
  proposal.appliedAt = null;
  if (proposal.target.kind === "model_bias") {
    delete store.bias[proposal.target.modelId];
  }
  store.audit.unshift({
    at: new Date().toISOString(),
    action: "proposal.rolled_back",
    detail: `${proposal.title} (${proposal.id})`,
  });
  store.audit = store.audit.slice(0, 200);
  return proposal;
}
