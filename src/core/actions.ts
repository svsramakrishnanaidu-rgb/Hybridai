/**
 * HYDRO AI — permission-gated execution engine.
 *
 * A plan is a list of named tools with validated arguments. Execution is
 * sequential, every step is verified against the real filesystem afterwards, and
 * the whole run is written to the execution history and the audit log.
 *
 * There is no shell, no PowerShell, no process spawning and no screen control in
 * this engine. Those need a privileged native agent with its own consent flow,
 * and pretending to have them would be worse than not having them.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LEVEL_NAMES,
  SandboxError,
  exists,
  getLevel,
  levelAllows,
  listDir,
  logAudit,
  makeFolder,
  movePath,
  readText,
  requiredLevelFor,
  searchFiles,
  statOf,
  systemInfo,
  trashPath,
  writeText,
  type Level,
} from "./ai-home.ts";
import type { Plan, PlanStep } from "./planner.ts";

export interface StepResult {
  tool: string;
  ok: boolean;
  detail: string;
  data?: unknown;
}

export interface ExecutionRecord {
  id: string;
  at: string;
  instruction: string;
  intent: string;
  level: Level;
  ok: boolean;
  /** true when the user's emergency stop ended the run early */
  cancelled?: boolean;
  results: StepResult[];
  summary: string;
}

const HISTORY_FILE = join(process.cwd(), ".data", "executions.json");
const MAX_HISTORY = 100;
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Cooperative cancellation for the emergency stop.
 *
 * A run captures the generation it started in. Pressing stop increments it, and
 * the run declines to start its next step — it never interrupts a write that is
 * already in progress, so a file cannot be left half-written.
 */
let generation = 0;

export function requestCancel(): number {
  generation += 1;
  return generation;
}

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

function newId(): string {
  return `run_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export async function readHistory(limit = 25): Promise<ExecutionRecord[]> {
  try {
    const raw = await readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as ExecutionRecord[];
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

async function appendHistory(record: ExecutionRecord): Promise<void> {
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await serial(async () => {
    const current = await readHistory(MAX_HISTORY);
    const next = [record, ...current].slice(0, MAX_HISTORY);
    const tmp = `${HISTORY_FILE}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, HISTORY_FILE);
  });
}

function denial(tool: string, need: Level, level: Level): StepResult {
  return {
    tool,
    ok: false,
    detail: `Blocked: ${tool} needs permission level ${need} (${LEVEL_NAMES[need]}); current level is ${level} (${LEVEL_NAMES[level]}).`,
  };
}

/** Execute one step and verify its effect on disk. */
export async function executeStep(step: PlanStep, level: Level): Promise<StepResult> {
  const need = requiredLevelFor(step.tool);
  if (!levelAllows(level, step.tool)) return denial(step.tool, need, level);

  try {
    switch (step.tool) {
      case "system.info":
        return { tool: step.tool, ok: true, detail: "Read live system metrics", data: systemInfo() };

      case "home.list": {
        const path = String(step.args.path ?? "");
        const listing = await listDir(path);
        return {
          tool: step.tool,
          ok: true,
          detail: `${listing.entries.length} item(s) in ${listing.path || "/"}`,
          data: listing,
        };
      }

      case "home.read": {
        const path = String(step.args.path ?? "");
        const file = await readText(path);
        return {
          tool: step.tool,
          ok: true,
          detail: `Read ${file.bytes} bytes from ${file.path}${file.truncated ? " (truncated)" : ""}`,
          data: file,
        };
      }

      case "home.search": {
        const query = String(step.args.query ?? "");
        const hits = await searchFiles(query, 25);
        return {
          tool: step.tool,
          ok: true,
          detail: `${hits.length} match(es) for "${query}" in the AI home`,
          data: hits,
        };
      }

      case "home.mkdir": {
        const path = String(step.args.path ?? "");
        const made = await makeFolder(path);
        const verified = await statOf(made.path);
        return {
          tool: step.tool,
          ok: verified?.type === "dir",
          detail: made.created ? `Created folder ${made.path}` : `Folder ${made.path} already existed`,
          data: made,
        };
      }

      case "home.write": {
        const path = String(step.args.path ?? "");
        const content = String(step.args.content ?? "");
        const already = await exists(path);
        if (already && level < 3) {
          return {
            tool: step.tool,
            ok: false,
            detail: `Blocked: ${path} already exists. Overwriting needs level 3 (${LEVEL_NAMES[3]}).`,
          };
        }
        const written = await writeText(path, content, { overwrite: already && level >= 3 });
        const check = await readText(path);
        // Compare the actual bytes, not just the length: two different strings of
        // the same size used to pass as a verified write.
        const matches = check.truncated
          ? check.bytes === Buffer.byteLength(content)
          : check.content === content;
        return {
          tool: step.tool,
          ok: matches,
          detail: matches
            ? `${written.created ? "Created" : "Overwrote"} ${written.path} (${written.bytes} bytes verified)`
            : `Wrote ${written.path} but read-back did not match`,
          data: written,
        };
      }

      case "home.move": {
        const from = String(step.args.from ?? "");
        const to = String(step.args.to ?? "");
        const moved = await movePath(from, to);
        const [sourceGone, targetThere] = await Promise.all([exists(moved.from), exists(moved.to)]);
        return {
          tool: step.tool,
          ok: !sourceGone && targetThere,
          detail: !sourceGone && targetThere ? `Moved ${moved.from} → ${moved.to}` : "Move could not be verified",
          data: moved,
        };
      }

      case "home.trash": {
        const path = String(step.args.path ?? "");
        const trashed = await trashPath(path);
        const gone = !(await exists(trashed.path));
        return {
          tool: step.tool,
          ok: gone,
          detail: gone
            ? `Moved ${trashed.path} to ${trashed.trashedTo} — restorable by moving it back`
            : "Trash move could not be verified",
          data: trashed,
        };
      }

      default:
        return { tool: String(step.tool), ok: false, detail: "Unknown tool" };
    }
  } catch (err) {
    const message =
      err instanceof SandboxError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { tool: step.tool, ok: false, detail: message };
  }
}

/** Run every step in order, stopping at the first failure. */
export async function executePlan(plan: Plan, instruction: string): Promise<ExecutionRecord> {
  // Captured before any await: a stop pressed while the plan is still resolving
  // permissions should also take effect, not just one pressed mid-execution.
  const gen = generation;
  const level = await getLevel();
  const record: ExecutionRecord = {
    id: newId(),
    at: new Date().toISOString(),
    instruction: instruction.slice(0, 400),
    intent: plan.intent,
    level,
    ok: false,
    results: [],
    summary: "",
  };

  for (const step of plan.steps) {
    if (generation !== gen) {
      record.cancelled = true;
      await logAudit(
        "plan.cancelled",
        `Emergency stop after ${record.results.length} step(s) of ${plan.intent}`,
      );
      break;
    }
    const result = await executeStep(step, level);
    record.results.push(result);
    await logAudit(`${step.tool}${result.ok ? "" : ".denied_or_failed"}`, result.detail.slice(0, 240));
    if (!result.ok) break;
  }

  record.ok = !record.cancelled && record.results.length > 0 && record.results.every((r) => r.ok);
  record.summary = record.cancelled
    ? `Cancelled by your emergency stop${record.results.length ? ` after ${record.results.length} step(s)` : " before any step ran"}. Nothing further was changed.`
    : record.ok
      ? record.results.map((r) => r.detail).join(" · ")
      : (record.results.find((r) => !r.ok)?.detail ?? "Nothing was executed.");
  await appendHistory(record);
  return record;
}

/** Cheap pre-flight so the UI can warn before showing an execute button. */
export async function describeLevel(): Promise<{ level: Level; name: string }> {
  const level = await getLevel();
  return { level, name: LEVEL_NAMES[level] };
}
