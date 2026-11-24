/**
 * HYDRO AI — memory and telemetry store.
 *
 * Consent is the gate: nothing durable is written until the user enables memory,
 * and every record carries its source and status so it can be inspected, edited
 * or deleted. Reliability counters are numeric observations, not "learning".
 *
 * Storage is a single JSON document on disk for local operation. Swapping in
 * Postgres or D1 means reimplementing this module's five exported functions.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReliabilityStat } from "@/core/router";
import { sanitizeRule } from "./speech/pronounce.ts";
import { DEFAULT_SPEECH_SETTINGS, normalizeSpeechSettings, type SpeechSettings } from "./speech/settings.ts";
import { uid } from "./util.ts";

export type MemoryType = "preference" | "episodic" | "semantic";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  source: string;
  createdAt: string;
  expiresAt: string | null;
  consentRef: string;
  status: "active" | "superseded";
  /** project the fact belongs to; undefined means it applies everywhere */
  project?: string;
}

export interface Proposal {
  id: string;
  createdAt: string;
  title: string;
  rationale: string;
  evidence: string;
  target: { kind: "model_bias"; modelId: string; factor: number } | { kind: "noop" };
  status: "proposed" | "approved" | "rejected";
  appliedAt: string | null;
}

export interface Store {
  version: 1;
  settings: {
    memoryEnabled: boolean;
    learningPaused: boolean;
    voiceEnabled: boolean;
    lastGenesisAt: string | null;
    /** voice preferences: language, voice, mode, pronunciation rules */
    speech: SpeechSettings;
  };
  memory: MemoryRecord[];
  stats: Record<string, ReliabilityStat>;
  proposals: Proposal[];
  /** approved routing biases, applied by the router; 1 = neutral */
  bias: Record<string, number>;
  usage: { requests: number; calls: number; costUsd: number; tokens: number };
  audit: Array<{ at: string; action: string; detail: string }>;
}

const DATA_DIR = join(process.cwd(), ".data");
const FILE = join(DATA_DIR, "hydro.json");

const EMPTY: Store = {
  version: 1,
  settings: {
    memoryEnabled: false,
    learningPaused: false,
    voiceEnabled: false,
    lastGenesisAt: null,
    speech: DEFAULT_SPEECH_SETTINGS,
  },
  memory: [],
  stats: {},
  proposals: [],
  bias: {},
  usage: { requests: 0, calls: 0, costUsd: 0, tokens: 0 },
  audit: [],
};

let queue: Promise<unknown> = Promise.resolve();

/** Serialize all mutations so concurrent requests cannot clobber the document. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Repair a store document of unknown shape.
 *
 * JSON that parses is not JSON that is usable: a truncated write, a hand edit or
 * a record with a missing field used to reach `.unshift`/`.filter` on a
 * non-array and fail every request until the file was deleted. Unknown fields
 * are dropped, arrays are rebuilt from their valid members, and settings are
 * coerced to real booleans. Recovering here keeps the user's other records.
 */
export function normalizeStore(parsed: unknown): Store {
  const raw = (parsed && typeof parsed === "object" ? parsed : {}) as Partial<Store>;
  const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const settings: Record<string, unknown> = record(raw.settings) ? raw.settings : {};

  return {
    version: 1,
    settings: {
      memoryEnabled: settings.memoryEnabled === true,
      learningPaused: settings.learningPaused === true,
      voiceEnabled: settings.voiceEnabled === true,
      lastGenesisAt:
        typeof settings.lastGenesisAt === "string" ? settings.lastGenesisAt : null,
      speech: (() => {
        const speech = normalizeSpeechSettings(settings.speech);
        // Rules are stored in the same document as other user data, so they are
        // sanitised on read as well as on write: a hand-edited file must not be
        // able to inject markup into a speech request.
        speech.pronunciation = speech.pronunciation
          .map(sanitizeRule)
          .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule))
          .slice(0, 60);
        return speech;
      })(),
    },
    memory: Array.isArray(raw.memory)
      ? raw.memory.filter(
          (m): m is MemoryRecord =>
            record(m) &&
            typeof m.id === "string" &&
            typeof m.content === "string" &&
            (m.type === "preference" || m.type === "episodic" || m.type === "semantic"),
        )
      : [],
    stats: record(raw.stats) ? (raw.stats as Store["stats"]) : {},
    proposals: Array.isArray(raw.proposals)
      ? raw.proposals.filter((p): p is Proposal => record(p) && typeof p.id === "string")
      : [],
    bias: record(raw.bias) ? (raw.bias as Store["bias"]) : {},
    usage: {
      requests: Number(raw.usage?.requests) || 0,
      calls: Number(raw.usage?.calls) || 0,
      costUsd: Number(raw.usage?.costUsd) || 0,
      tokens: Number(raw.usage?.tokens) || 0,
    },
    audit: Array.isArray(raw.audit)
      ? raw.audit.filter(
          (a): a is Store["audit"][number] => record(a) && typeof a.action === "string",
        )
      : [],
  };
}

export async function readStore(): Promise<Store> {
  try {
    const raw = await readFile(FILE, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return structuredClone(EMPTY);
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

export function mutate<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  return serial(async () => {
    const store = await readStore();
    const result = await fn(store);
    await write(store);
    return result;
  });
}

export function audit(store: Store, action: string, detail: string): void {
  store.audit.unshift({ at: new Date().toISOString(), action, detail });
  store.audit = store.audit.slice(0, 200);
}

export function addMemory(
  store: Store,
  input: {
    type: MemoryType;
    content: string;
    source: string;
    consentRef: string;
    project?: string;
  },
): MemoryRecord {
  const content = input.content.slice(0, 600);
  const project = input.project?.trim().toLowerCase().slice(0, 40) || undefined;

  // Repeated identical statements are the same memory, not a new one. Copying
  // them used to flood retrieval with near-duplicates of the same sentence.
  const duplicate = store.memory.find(
    (m) => m.status === "active" && m.type === input.type && m.content === content,
  );
  if (duplicate) return duplicate;

  const record: MemoryRecord = {
    id: uid("mem"),
    type: input.type,
    content,
    source: input.source,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    consentRef: input.consentRef,
    status: "active",
    ...(project ? { project } : {}),
  };
  store.memory.unshift(record);
  store.memory = store.memory.slice(0, 400);
  return record;
}

/** Keyword-overlap retrieval. Deliberately simple and inspectable. */
export function retrieve(
  store: Store,
  query: string,
  limit = 5,
  project?: string,
): MemoryRecord[] {
  // A project-scoped fact is only given to that project; unscoped facts are
  // shared. Without this, two projects' saved decisions bleed into each other.
  const scope = project?.trim().toLowerCase();
  const active = store.memory.filter(
    (m) => m.status === "active" && (!m.project || !scope || m.project === scope),
  );
  if (!active.length) return [];
  const words = new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\u0C00-\u0C7F\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  return active
    .map((m) => {
      const overlap = m.content
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => words.has(w)).length;
      return { m, score: overlap + (m.type === "preference" ? 2 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

export function recordOutcome(
  store: Store,
  modelId: string,
  ok: boolean,
  tokens: number,
  costUsd: number,
  latencyMs = 0,
): void {
  const stat = store.stats[modelId] ?? { success: 0, fail: 0 };
  if (ok) stat.success += 1;
  else stat.fail += 1;
  if (latencyMs > 0) {
    stat.latencyMs = stat.latencyMs ? stat.latencyMs * 0.7 + latencyMs * 0.3 : latencyMs;
  }
  store.stats[modelId] = stat;
  store.usage.calls += 1;
  store.usage.tokens += tokens;
  store.usage.costUsd += costUsd;
}

/**
 * Explicit, user-stated preferences only. Inferred "personality" is not stored:
 * the record must be something the user actually said.
 */
export function preferenceSignal(text: string): string | null {
  const patterns = [
    /(?:remember(?: that)?|note that)\s+(.{4,220})/i,
    /(?:i prefer|i like|i always|i never|call me|my name is)\s+(.{2,220})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[0].trim().slice(0, 300);
  }
  return null;
}
