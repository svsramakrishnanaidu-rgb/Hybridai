/**
 * HYDRO AI — procedural memory (learned workflows).
 *
 * A workflow is learned from the user's own narration of a process. Each
 * sentence is parsed by the same deterministic planner used for direct
 * instructions, so a learned step is only marked executable if the engine has a
 * real tool for it. Everything else is stored as the user's description and
 * marked unsupported — the system never pretends it can perform a physical
 * action it has no actuator for.
 *
 * Drafts are inert. Execution requires explicit approval, and every run is
 * recorded.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { executePlan, type ExecutionRecord } from "./actions";
import { planInstruction, type PlanStep } from "./planner";

export interface WorkflowStep {
  instruction: string;
  tool: PlanStep["tool"] | null;
  args: Record<string, unknown>;
  supported: boolean;
}

export interface Workflow {
  id: string;
  title: string;
  createdAt: string;
  source: "narration" | "demonstration";
  transcript: string;
  steps: WorkflowStep[];
  status: "draft" | "approved" | "rejected";
  runs: number;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  note: string | null;
}

const FILE = join(process.cwd(), ".data", "workflows.json");
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function listWorkflows(): Promise<Workflow[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Workflow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function save(next: Workflow[]): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(next.slice(0, 80), null, 2), "utf8");
  await rename(tmp, FILE);
}

function uid(): string {
  return `wf_${Math.random().toString(36).slice(2, 10)}`;
}

function splitSteps(transcript: string): string[] {
  return transcript
    .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z\u0C00-\u0C7F])/u)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((s) => s.length > 3)
    .slice(0, 24);
}

export interface LearnInput {
  transcript: string;
  title?: string;
  /** Observed gesture markers, kept as evidence of the demonstration */
  markers?: Array<{ at: number; name: string; confidence: number }>;
}

export async function learnWorkflow(input: LearnInput): Promise<Workflow> {
  const transcript = (input.transcript ?? "").trim().slice(0, 8000);
  if (!transcript) throw new Error("A description of the process is required.");

  const sentences = splitSteps(transcript);
  const steps: WorkflowStep[] = sentences.map((sentence) => {
    const plan = planInstruction(sentence);
    const step = plan.handled ? plan.steps[0] : null;
    return {
      instruction: sentence.slice(0, 300),
      tool: step?.tool ?? null,
      args: step?.args ?? {},
      supported: Boolean(step),
    };
  });

  const supportedCount = steps.filter((s) => s.supported).length;
  const markerNote = input.markers?.length
    ? ` ${input.markers.length} gesture marker(s) were recorded during the demonstration.`
    : "";

  const workflow: Workflow = {
    id: uid(),
    title: (input.title?.trim() || sentences[0] || "Untitled workflow").slice(0, 90),
    createdAt: new Date().toISOString(),
    source: input.markers?.length ? "demonstration" : "narration",
    transcript,
    steps,
    status: "draft",
    runs: 0,
    lastRunAt: null,
    lastRunOk: null,
    note:
      supportedCount === 0
        ? "No step maps to a digital tool yet — saved for reference only." + markerNote
        : `${supportedCount} of ${steps.length} step(s) can run with the installed digital tools.` +
          (supportedCount < steps.length ? " The rest describe physical actions this system cannot perform." : "") +
          markerNote,
  };

  await serial(async () => {
    const current = await listWorkflows();
    await save([workflow, ...current]);
  });
  return workflow;
}

export async function decideWorkflow(
  id: string,
  action: "approve" | "reject" | "delete",
): Promise<Workflow | null> {
  return serial(async () => {
    const current = await listWorkflows();
    const target = current.find((w) => w.id === id);
    if (!target) return null;
    if (action === "delete") {
      await save(current.filter((w) => w.id !== id));
      return { ...target };
    }
    target.status = action === "approve" ? "approved" : "rejected";
    await save(current);
    return target;
  });
}

export async function runWorkflow(id: string): Promise<{ workflow: Workflow; record: ExecutionRecord } | null> {
  const current = await listWorkflows();
  const target = current.find((w) => w.id === id);
  if (!target || target.status !== "approved") return null;

  const steps: PlanStep[] = target.steps
    .filter((s) => s.supported && s.tool)
    .map((s) => ({
      tool: s.tool as PlanStep["tool"],
      args: s.args,
      note: s.instruction,
    }));

  const record = await executePlan(
    {
      handled: steps.length > 0,
      intent: `workflow:${target.id}`,
      steps,
      summary: target.title,
      needsClarification: steps.length ? null : "This workflow has no executable steps.",
      requiresApproval: false,
      risk: "low",
    },
    `Run workflow “${target.title}”`,
  );

  return serial(async () => {
    const latest = await listWorkflows();
    const wf = latest.find((w) => w.id === id);
    if (wf) {
      wf.runs += 1;
      wf.lastRunAt = new Date().toISOString();
      wf.lastRunOk = record.ok;
      await save(latest);
      return { workflow: wf, record };
    }
    return { workflow: target, record };
  });
}
