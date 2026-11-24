/**
 * Pending plans awaiting approval.
 *
 * Stored server-side so an approve request cannot carry a modified step list
 * from the browser: the client only ever sends the plan id.
 */

import type { Plan } from "./planner";

interface PendingPlan {
  plan: Plan;
  instruction: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, PendingPlan>();

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(id);
  }
}

export function putPending(plan: Plan, instruction: string): string {
  prune();
  const id = `plan_${Math.random().toString(36).slice(2, 10)}`;
  store.set(id, { plan, instruction, createdAt: Date.now() });
  return id;
}

export function takePending(id: string): { plan: Plan; instruction: string } | null {
  prune();
  const entry = store.get(id);
  if (!entry) return null;
  return { plan: entry.plan, instruction: entry.instruction };
}

export function dropPending(id: string): boolean {
  return store.delete(id);
}
