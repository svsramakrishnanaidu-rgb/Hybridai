"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconBolt,
  IconClose,
  IconDatabase,
  IconHand,
  IconPlay,
  IconShield,
  IconSpark,
} from "@/components/Icons";

/**
 * HYDRO workspace — the assistant's own storage, the execution history, the
 * learned workflows, the personal vocabulary and the permission level.
 *
 * Everything shown here is read from the server after the fact. Nothing is
 * optimistic: a file only appears in a listing once it exists on disk, and a
 * task only reads "done" when its verification step passed.
 */

type Tab = "files" | "tasks" | "workflows" | "voice" | "permissions";

interface Entry {
  name: string;
  path: string;
  type: "file" | "dir";
  bytes: number;
  modifiedAt: string;
}

interface HomeState {
  root: string;
  level: number;
  levelName: string;
  path: string;
  entries: Entry[];
  usage: {
    files: number;
    bytes: number;
    quotaBytes: number;
    folders: Array<{ name: string; files: number; bytes: number }>;
  };
  audit?: Array<{ at: string; action: string; detail: string }>;
  system: {
    platform: string;
    release?: string;
    arch: string;
    cpus: number;
    cpuModel: string;
    memoryTotalGb: number;
    memoryFreeGb: number;
    uptimeHours: number;
    nodeVersion: string;
  };
}

interface StepResult {
  tool: string;
  ok: boolean;
  detail: string;
  data?: unknown;
}

interface RunRecord {
  id: string;
  at: string;
  instruction: string;
  intent: string;
  level: number;
  ok: boolean;
  results: StepResult[];
  summary: string;
}

interface PlanStepView {
  tool: string;
  note: string;
}

interface PlanView {
  intent: string;
  summary: string;
  steps: PlanStepView[];
  requiresApproval: boolean;
  risk: string;
}

interface WorkflowView {
  id: string;
  title: string;
  createdAt: string;
  source: string;
  transcript: string;
  steps: Array<{ instruction: string; tool: string | null; supported: boolean }>;
  status: "draft" | "approved" | "rejected";
  runs: number;
  lastRunOk: boolean | null;
  note: string | null;
}

interface AliasView {
  id: string;
  alias: string;
  canonical: string;
}

interface GestureView {
  id: string;
  name: string;
  command: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** a plan requiring approval that was produced from the conversation */
  initialPlan?: { planId: string; plan: PlanView } | null;
  onPlanHandled?: () => void;
  /** true while a device run is in flight, so the hologram can show Executing */
  onRunning?: (running: boolean) => void;
}

const LEVEL_HINT: Record<number, string> = {
  1: "Read and search only.",
  2: "Create new files and folders.",
  3: "Overwrite, move, rename and move files to the trash.",
  4: "Administrator-level operations — requires a native agent (not installed).",
};

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default function WorkspacePanel({ open, onClose, initialPlan, onPlanHandled, onRunning }: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [home, setHome] = useState<HomeState | null>(null);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowView[]>([]);
  const [aliases, setAliases] = useState<AliasView[]>([]);
  const [gestures, setGestures] = useState<GestureView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [viewer, setViewer] = useState<{ path: string; content: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [authoring, setAuthoring] = useState<"file" | "folder" | null>(null);

  const [instruction, setInstruction] = useState("");
  const [pending, setPending] = useState<{ planId: string; plan: PlanView } | null>(initialPlan ?? null);
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);

  const [teachTranscript, setTeachTranscript] = useState("");
  const [teachTitle, setTeachTitle] = useState("");
  const [aliasPhrase, setAliasPhrase] = useState("");
  const [aliasMeaning, setAliasMeaning] = useState("");

  const loadedOnce = useRef(false);

  const loadHome = useCallback(async (path = "") => {
    const res = await fetch(`/api/home?path=${encodeURIComponent(path)}&audit=1`);
    const data = (await res.json()) as HomeState & { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not read the workspace");
      return;
    }
    setHome(data);
    setError(null);
  }, []);

  const loadAll = useCallback(async () => {
    setBusy(true);
    try {
      const [t, w, p] = await Promise.all([
        fetch("/api/tasks").then((r) => r.json()),
        fetch("/api/workflows").then((r) => r.json()),
        fetch("/api/personal").then((r) => r.json()),
      ]);
      setHistory((t.history ?? []) as RunRecord[]);
      setWorkflows((w.workflows ?? []) as WorkflowView[]);
      setAliases((p.aliases ?? []) as AliasView[]);
      setGestures((p.gestures ?? []) as GestureView[]);
      await loadHome(home?.path ?? "");
    } finally {
      setBusy(false);
    }
  }, [home?.path, loadHome]);

  useEffect(() => {
    if (!open) return;
    if (initialPlan) setPending(initialPlan);
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      void loadAll();
    } else {
      void loadHome(home?.path ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPlan]);

  const setLevel = async (level: number) => {
    const res = await fetch("/api/home", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level }),
    });
    const data = (await res.json()) as { level?: number; error?: string };
    if (!res.ok) setError(data.error ?? "Could not change the permission level");
    await loadHome(home?.path ?? "");
  };

  const runTask = async (text = instruction) => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    onRunning?.(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: text }),
      });
      const data = (await res.json()) as {
        kind?: string;
        plan?: PlanView;
        planId?: string;
        record?: RunRecord;
        message?: string;
        error?: string;
      };
      if (data.kind === "executed" && data.record) {
        setLastRun(data.record);
        setPending(null);
        setInstruction("");
        await loadHome(home?.path ?? "");
        setHistory((await fetch("/api/tasks").then((r) => r.json())).history ?? []);
      } else if (data.kind === "approval_required" && data.plan && data.planId) {
        setPending({ planId: data.planId, plan: data.plan });
      } else if (data.kind === "workflow" && data.record) {
        setLastRun(data.record);
        await loadAll();
      } else {
        setError(data.message ?? data.error ?? "That instruction did not produce an executable step.");
      }
    } finally {
      setBusy(false);
      onRunning?.(false);
    }
  };

  const approvePending = async () => {
    if (!pending) return;
    setBusy(true);
    onRunning?.(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: pending.planId, approve: true }),
      });
      const data = (await res.json()) as { record?: RunRecord; error?: string };
      if (data.record) {
        setLastRun(data.record);
        setPending(null);
        onPlanHandled?.();
        await loadHome(home?.path ?? "");
        setHistory((await fetch("/api/tasks").then((r) => r.json())).history ?? []);
      } else {
        setError(data.error ?? "Execution failed");
      }
    } finally {
      setBusy(false);
      onRunning?.(false);
    }
  };

  const cancelPending = async () => {
    if (pending) await fetch(`/api/tasks?id=${encodeURIComponent(pending.planId)}`, { method: "DELETE" });
    setPending(null);
    onPlanHandled?.();
  };

  const createEntry = async () => {
    const name = newName.trim();
    if (!name) return;
    const path = home?.path ? `${home.path}/${name}` : name;
    setBusy(true);
    try {
      const res = await fetch("/api/home/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          authoring === "folder"
            ? { op: "mkdir", path }
            : { op: "write", path, content: newContent },
        ),
      });
      const data = (await res.json()) as { result?: StepResult; error?: string };
      if (!res.ok || !data.result?.ok) {
        setError(data.result?.detail ?? data.error ?? "Could not create that");
      } else {
        setNewName("");
        setNewContent("");
        setAuthoring(null);
        await loadHome(home?.path ?? "");
      }
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (entry: Entry) => {
    if (entry.type === "dir") {
      await loadHome(entry.path);
      setViewer(null);
      return;
    }
    const res = await fetch(`/api/home/file?path=${encodeURIComponent(entry.path)}`);
    const data = (await res.json()) as { path?: string; content?: string; error?: string };
    if (!res.ok || data.content === undefined) {
      setError(data.error ?? "Could not read that file");
      return;
    }
    setViewer({ path: data.path ?? entry.path, content: data.content });
  };

  const trash = async (entry: Entry) => {
    if (!window.confirm(`Move “${entry.path}” to the AI home trash? It stays restorable.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/home/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "trash", path: entry.path }),
      });
      const data = (await res.json()) as { result?: StepResult; error?: string };
      if (!res.ok || !data.result?.ok) setError(data.result?.detail ?? data.error ?? "Could not move it");
      else if (viewer?.path === entry.path) setViewer(null);
      await loadHome(home?.path ?? "");
    } finally {
      setBusy(false);
    }
  };

  const learn = async () => {
    if (!teachTranscript.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "learn", transcript: teachTranscript, title: teachTitle }),
      });
      const data = (await res.json()) as { workflows?: WorkflowView[]; error?: string };
      if (!res.ok) setError(data.error ?? "Could not learn that workflow");
      else {
        setWorkflows(data.workflows ?? []);
        setTeachTranscript("");
        setTeachTitle("");
      }
    } finally {
      setBusy(false);
    }
  };

  const workflowAction = async (id: string, action: "approve" | "reject" | "delete" | "run") => {
    setBusy(true);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const data = (await res.json()) as { workflows?: WorkflowView[]; record?: RunRecord; error?: string };
      if (!res.ok) setError(data.error ?? "Workflow action failed");
      else {
        if (data.record) setLastRun(data.record);
        setWorkflows(data.workflows ?? []);
      }
    } finally {
      setBusy(false);
    }
  };

  const addAlias = async () => {
    if (!aliasPhrase.trim() || !aliasMeaning.trim()) return;
    const res = await fetch("/api/personal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "alias", alias: aliasPhrase, canonical: aliasMeaning }),
    });
    const data = (await res.json()) as { aliases?: AliasView[]; error?: string };
    if (!res.ok) setError(data.error ?? "Could not save that phrase");
    else {
      setAliases(data.aliases ?? []);
      setAliasPhrase("");
      setAliasMeaning("");
    }
  };

  const removeAlias = async (id: string) => {
    await fetch(`/api/personal?kind=alias&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = (await fetch("/api/personal").then((r) => r.json())) as { aliases: AliasView[] };
    setAliases(data.aliases ?? []);
  };

  const removeGesture = async (id: string) => {
    await fetch(`/api/personal?kind=gesture&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = (await fetch("/api/personal").then((r) => r.json())) as { gestures: GestureView[] };
    setGestures(data.gestures ?? []);
  };

  if (!open) return null;

  const usedPct = home ? Math.min(100, Math.round((home.usage.bytes / home.usage.quotaBytes) * 100)) : 0;
  const parentPath = home?.path ? home.path.split("/").slice(0, -1).join("/") : null;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet ws-sheet" role="dialog" aria-label="HYDRO workspace">
        <div className="inspector-head">
          <span className="inspector-title">WORKSPACE</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close workspace">
            <IconClose size={15} />
          </button>
        </div>

        <div className="tabs" role="tablist">
          {(["files", "tasks", "workflows", "voice", "permissions"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className="tab"
              data-on={tab === t}
              onClick={() => setTab(t)}
              style={{ textTransform: "capitalize" }}
            >
              {t}
            </button>
          ))}
        </div>

        {error && <div className="ws-error">{error}</div>}

        {/* ── files ─────────────────────────────────────────────────────── */}
        {tab === "files" && home && (
          <>
            <div className="ws-pathbar">
              <button type="button" className="ghost-btn" onClick={() => void loadHome("")}>
                home
              </button>
              {parentPath !== null && (
                <button type="button" className="ghost-btn" onClick={() => void loadHome(parentPath)}>
                  ← up
                </button>
              )}
              <span className="ws-path">/{home.path}</span>
              <span className="ws-level" data-level={home.level}>
                L{home.level} {home.levelName}
              </span>
            </div>

            <div className="ws-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setAuthoring(authoring === "file" ? null : "file")}
              >
                + file
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setAuthoring(authoring === "folder" ? null : "folder")}
              >
                + folder
              </button>
              <button type="button" className="ghost-btn" onClick={() => void loadHome(home.path)} disabled={busy}>
                refresh
              </button>
            </div>

            {authoring && (
              <div className="ws-author">
                <input
                  className="field"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={authoring === "folder" ? "folder-name" : "notes.md"}
                />
                {authoring === "file" && (
                  <textarea
                    className="field"
                    rows={4}
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="File content (optional)"
                  />
                )}
                <div className="ws-actions">
                  <button type="button" className="ghost-btn" onClick={() => void createEntry()} disabled={!newName.trim()}>
                    Create
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => setAuthoring(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="ws-list">
              {home.entries.length === 0 && <div className="card-body">Empty folder.</div>}
              {home.entries.map((entry) => (
                <div className="ws-row" key={entry.path}>
                  <button
                    type="button"
                    className="ws-entry"
                    onClick={() => void openFile(entry)}
                    title={entry.type === "dir" ? "Open folder" : "Read file"}
                  >
                    <span className="ws-kind" data-kind={entry.type}>
                      {entry.type === "dir" ? "▸" : "·"}
                    </span>
                    <span className="ws-name">{entry.name}</span>
                    <span className="ws-meta">
                      {entry.type === "dir" ? "folder" : fmtBytes(entry.bytes)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ws-trash"
                    onClick={() => void trash(entry)}
                    title="Move to trash (level 3)"
                    aria-label={`Move ${entry.name} to trash`}
                  >
                      ×
                  </button>
                </div>
              ))}
            </div>

            {viewer && (
              <div className="ws-viewer">
                <div className="ws-viewer-head">
                  <span>{viewer.path}</span>
                  <button type="button" className="icon-btn" onClick={() => setViewer(null)} aria-label="Close file">
                    <IconClose size={12} />
                  </button>
                </div>
                <pre>{viewer.content.slice(0, 20_000)}</pre>
              </div>
            )}
          </>
        )}

        {/* ── tasks ─────────────────────────────────────────────────────── */}
        {tab === "tasks" && (
          <>
            <div className="panel-title">Device tasks</div>
            <div className="card-body" style={{ marginBottom: 8 }}>
              Instructions run against the AI home only. Level 3 actions and anything that overwrites
              need your approval; every run is listed below with its verified result.
            </div>
            <div className="ws-actions">
              <input
                className="field"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runTask();
                }}
                placeholder="create a file called notes.md · list my projects · find caching"
              />
              <button type="button" className="ghost-btn" onClick={() => void runTask()} disabled={busy}>
                <IconPlay size={12} /> Run
              </button>
            </div>

            {pending && (
              <div className="ws-plan">
                <div className="card-head">
                  <span className="card-title">Approval required</span>
                  <span className="badge" data-tone="warn">
                    {pending.plan.risk} risk
                  </span>
                </div>
                <div className="card-body">{pending.plan.summary}</div>
                <ul className="ws-steps">
                  {pending.plan.steps.map((s, i) => (
                    <li key={i}>
                      <code>{s.tool}</code> {s.note}
                    </li>
                  ))}
                </ul>
                <div className="ws-actions">
                  <button type="button" className="ghost-btn" onClick={() => void approvePending()} disabled={busy}>
                    Execute
                  </button>
                  <button type="button" className="ghost-btn" data-danger="true" onClick={() => void cancelPending()}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {lastRun && (
              <div className="ws-plan" data-ok={lastRun.ok}>
                <div className="card-head">
                  <span className="card-title">{lastRun.ok ? "Verified" : "Failed"}</span>
                  <span className="badge" data-tone={lastRun.ok ? "ok" : "warn"}>
                    {lastRun.intent}
                  </span>
                </div>
                <div className="card-body">{lastRun.summary}</div>
                <ul className="ws-steps">
                  {lastRun.results.map((r, i) => (
                    <li key={i} data-ok={r.ok}>
                      <code>{r.tool}</code> {r.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="sec-label">History · {history.length}</div>
            {history.length === 0 && <div className="card-body">Nothing executed yet.</div>}
            {history.slice(0, 12).map((run) => (
              <div className="mem-row" key={run.id}>
                <span className="agent-dot" data-s={run.ok ? "complete" : "failed"} />
                <div className="mem-body">
                  {run.instruction}
                  <div className="mem-meta">
                    {run.summary} · {new Date(run.at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── workflows ─────────────────────────────────────────────────── */}
        {tab === "workflows" && (
          <>
            <div className="panel-title">Procedural memory</div>
            <div className="card-body" style={{ marginBottom: 8 }}>
              Describe a process step by step, or narrate it. Each sentence becomes a step; steps
              that map to a real digital tool are marked executable. A workflow never runs until
              you approve it, and physical actions cannot be performed without hardware.
            </div>
            <input
              className="field"
              value={teachTitle}
              onChange={(e) => setTeachTitle(e.target.value)}
              placeholder="Workflow name (optional)"
            />
            <textarea
              className="field"
              rows={5}
              value={teachTranscript}
              onChange={(e) => setTeachTranscript(e.target.value)}
              placeholder={"First I create a file called plan.md.\nThen I list my projects folder."}
              style={{ marginTop: 8 }}
            />
            <div className="ws-actions" style={{ marginTop: 8 }}>
              <button type="button" className="ghost-btn" onClick={() => void learn()} disabled={busy || !teachTranscript.trim()}>
                <IconSpark size={12} /> Learn
              </button>
            </div>

            {workflows.map((wf) => (
              <div className="card" key={wf.id}>
                <div className="card-head">
                  <span className="card-title">{wf.title}</span>
                  <span className="badge" data-tone={wf.status === "approved" ? "ok" : wf.status === "rejected" ? "warn" : "info"}>
                    {wf.status}
                  </span>
                </div>
                <div className="card-body">{wf.note}</div>
                <ul className="ws-steps">
                  {wf.steps.map((s, i) => (
                    <li key={i} data-ok={s.supported}>
                      {s.supported ? "✓" : "—"} {s.instruction}
                      {!s.supported && <span className="ws-unsupported"> · no digital tool</span>}
                    </li>
                  ))}
                </ul>
                <div className="ws-actions">
                  {wf.status === "draft" && (
                    <>
                      <button type="button" className="ghost-btn" onClick={() => void workflowAction(wf.id, "approve")}>
                        Approve
                      </button>
                      <button type="button" className="ghost-btn" onClick={() => void workflowAction(wf.id, "reject")}>
                        Reject
                      </button>
                    </>
                  )}
                  {wf.status === "approved" && (
                    <button type="button" className="ghost-btn" onClick={() => void workflowAction(wf.id, "run")} disabled={busy}>
                      <IconBolt size={12} /> Run
                    </button>
                  )}
                  <button type="button" className="ghost-btn" data-danger="true" onClick={() => void workflowAction(wf.id, "delete")}>
                    Delete
                  </button>
                </div>
                <div className="mem-meta">
                  {wf.runs} run{wf.runs === 1 ? "" : "s"} · source: {wf.source}
                  {wf.lastRunOk !== null ? ` · last ${wf.lastRunOk ? "ok" : "failed"}` : ""}
                </div>
              </div>
            ))}
            {workflows.length === 0 && <div className="card-body">No workflows learned yet.</div>}
          </>
        )}

        {/* ── voice ─────────────────────────────────────────────────────── */}
        {tab === "voice" && (
          <>
            <div className="panel-title">Personal vocabulary</div>
            <div className="card-body" style={{ marginBottom: 8 }}>
              Teach a phrase and what it means. Your phrases are expanded before a command is
              planned, so “open work” can mean “list my projects folder”. Speech audio is not
              stored and no voice profile is created.
            </div>
            <input
              className="field"
              value={aliasPhrase}
              onChange={(e) => setAliasPhrase(e.target.value)}
              placeholder="when I say…"
            />
            <input
              className="field"
              value={aliasMeaning}
              onChange={(e) => setAliasMeaning(e.target.value)}
              placeholder="…I mean this instruction"
              style={{ marginTop: 8 }}
            />
            <div className="ws-actions" style={{ marginTop: 8 }}>
              <button type="button" className="ghost-btn" onClick={() => void addAlias()} disabled={!aliasPhrase.trim() || !aliasMeaning.trim()}>
                Save phrase
              </button>
            </div>
            {aliases.length === 0 && <div className="card-body">No phrases yet.</div>}
            {aliases.map((a) => (
              <div className="mem-row" key={a.id}>
                <div className="mem-body">
                  “{a.alias}” → {a.canonical}
                </div>
                <button type="button" className="ghost-btn" data-danger="true" onClick={() => void removeAlias(a.id)}>
                  Delete
                </button>
              </div>
            ))}

            <div className="sec-label">Custom gestures · {gestures.length}</div>
            <div className="card-body" style={{ marginBottom: 8 }}>
              Capture a pose from the vision panel using <IconHand size={12} /> Learn a gesture.
              A pose must match within 0.22 normalised units to fire, and it only triggers a
              reversible action.
            </div>
            {gestures.length === 0 && <div className="card-body">No custom gestures yet.</div>}
            {gestures.map((g) => (
              <div className="mem-row" key={g.id}>
                <div className="mem-body">
                  {g.name}
                  <div className="mem-meta">→ {g.command}</div>
                </div>
                <button type="button" className="ghost-btn" data-danger="true" onClick={() => void removeGesture(g.id)}>
                  Delete
                </button>
              </div>
            ))}
          </>
        )}

        {/* ── permissions ───────────────────────────────────────────────── */}
        {tab === "permissions" && home && (
          <>
            <div className="panel-title">Permission level</div>
            <div className="ws-actions">
              {[1, 2, 3].map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  className="ghost-btn"
                  data-on={home.level === lvl}
                  onClick={() => void setLevel(lvl)}
                >
                  <IconShield size={12} /> L{lvl} {lvl === 1 ? "Observe" : lvl === 2 ? "Create" : "Manage"}
                </button>
              ))}
            </div>
            <div className="card-body" style={{ marginTop: 8 }}>
              {LEVEL_HINT[home.level]} {LEVEL_HINT[4]}
            </div>

            <div className="sec-label">Storage</div>
            <div className="ws-quota">
              <div className="ws-quota-bar">
                <span style={{ width: `${usedPct}%` }} />
              </div>
              <div className="card-body">
                {fmtBytes(home.usage.bytes)} of {fmtBytes(home.usage.quotaBytes)} ·{" "}
                {home.usage.files} file(s) · {home.usage.folders.length} folder(s) in use
              </div>
              <div className="mem-meta">{home.root}</div>
            </div>

            <div className="sec-label">Host</div>
            <div className="card-body">
              {home.system.platform} {home.system.release ?? ""} · {home.system.arch} ·{" "}
              {home.system.cpus} CPU · {home.system.memoryFreeGb}/
              {home.system.memoryTotalGb} GB free · node {home.system.nodeVersion}
              <br />
              {home.system.cpuModel}
            </div>

            <div className="sec-label">Audit log</div>
            {(home.audit ?? []).length === 0 && <div className="card-body">Empty.</div>}
            {(home.audit ?? []).map((a, i) => (
              <div className="mem-row" key={i}>
                <IconDatabase size={12} />
                <div className="mem-body">
                  {a.action}
                  <div className="mem-meta">
                    {a.detail} · {new Date(a.at).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
