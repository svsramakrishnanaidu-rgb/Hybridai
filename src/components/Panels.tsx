"use client";

import { useCallback, useEffect, useState } from "react";
import { IconClose } from "@/components/Icons";
import VoiceSettings from "@/components/VoiceSettings";
import type { VoiceApi } from "@/lib/useVoice";
import { ABILITIES, ABILITY_STATE_LABEL, abilityCounts } from "@/lib/assistant/status";

type Tab = "memory" | "voice" | "providers" | "evolution" | "abilities";

interface MemoryRecord {
  id: string;
  type: string;
  content: string;
  source: string;
  createdAt: string;
}

interface Settings {
  memoryEnabled: boolean;
  learningPaused: boolean;
  voiceEnabled: boolean;
}

interface ProviderHealth {
  id: string;
  label: string;
  configured: boolean;
  online: boolean;
  latencyMs: number | null;
  note: string | null;
}

interface ModelRow {
  id: string;
  label: string;
  providerLabel: string;
  online: boolean;
  score: number;
  reliability: number;
  samples: number;
  failures: number;
  pricePerMTok: number;
}

interface Proposal {
  id: string;
  title: string;
  rationale: string;
  evidence: string;
  status: "proposed" | "approved" | "rejected";
  appliedAt: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSettingsChange?: (settings: Settings) => void;
  /** the live voice pipeline, so the panel edits what is actually playing */
  voice: VoiceApi;
}

export default function Panels({ open, onClose, onSettingsChange, voice }: Props) {
  const [tab, setTab] = useState<Tab>("memory");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [memory, setMemory] = useState<MemoryRecord[]>([]);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [capabilities, setCapabilities] = useState<{ stt: boolean; tts: boolean; search: boolean } | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [audit, setAudit] = useState<Array<{ at: string; action: string; detail: string }>>([]);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadMemory = useCallback(async () => {
    const res = await fetch("/api/memory");
    const data = (await res.json()) as { settings: Settings; memory: MemoryRecord[] };
    setSettings(data.settings);
    setMemory(data.memory ?? []);
    onSettingsChange?.(data.settings);
  }, [onSettingsChange]);

  const loadProviders = useCallback(async () => {
    const res = await fetch("/api/providers");
    const data = (await res.json()) as {
      providers: ProviderHealth[];
      models: ModelRow[];
      capabilities: { stt: boolean; tts: boolean; search: boolean };
    };
    setProviders(data.providers ?? []);
    setModels(data.models ?? []);
    setCapabilities(data.capabilities ?? null);
  }, []);

  const loadEvolution = useCallback(async () => {
    const res = await fetch("/api/evolution");
    const data = (await res.json()) as {
      proposals: Proposal[];
      audit: Array<{ at: string; action: string; detail: string }>;
    };
    setProposals(data.proposals ?? []);
    setAudit(data.audit ?? []);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await Promise.all([loadMemory(), loadProviders(), loadEvolution()]);
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadMemory, loadProviders, loadEvolution]);

  const patchSettings = async (patch: Partial<Settings>) => {
    const res = await fetch("/api/memory", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await res.json()) as { settings: Settings };
    setSettings(data.settings);
    onSettingsChange?.(data.settings);
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: note }),
    });
    setNote("");
    await loadMemory();
    setBusy(false);
  };

  const removeRecord = async (id: string) => {
    await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadMemory();
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) return;
    await fetch("/api/memory", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, content: editText }),
    });
    setEditing(null);
    setEditText("");
    await loadMemory();
  };

  const clearAll = async () => {
    await fetch("/api/memory?all=1", { method: "DELETE" });
    await loadMemory();
  };

  const exportMemory = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), memory }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hydro-memory.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const decide = async (id: string, action: "approve" | "reject" | "rollback") => {
    await fetch("/api/evolution", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    await loadEvolution();
    await loadProviders();
  };

  if (!open) return null;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="HYDRO controls">
        <div className="inspector-head">
          <span className="inspector-title">HYDRO</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel">
            <IconClose size={15} />
          </button>
        </div>

        <div className="tabs" role="tablist">
          {(["memory", "voice", "providers", "evolution", "abilities"] as Tab[]).map((t) => (
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

        {tab === "memory" && (
          <>
            <div className="panel-title">Memory &amp; consent</div>
            <div className="card">
              <label className="toggle">
                <span className="switch" data-on={settings?.memoryEnabled ?? false} />
                <input
                  type="checkbox"
                  hidden
                  checked={settings?.memoryEnabled ?? false}
                  onChange={(e) => void patchSettings({ memoryEnabled: e.target.checked })}
                />
                Personal memory
              </label>
              <div className="card-body" style={{ marginTop: 8 }}>
                Off by default. When on, HYDRO stores only what you explicitly say plus a short
                summary of each exchange. Everything below is editable and deletable.
              </div>
            </div>

            <div className="card">
              <label className="toggle">
                <span className="switch" data-on={settings?.learningPaused ?? false} />
                <input
                  type="checkbox"
                  hidden
                  checked={settings?.learningPaused ?? false}
                  onChange={(e) => void patchSettings({ learningPaused: e.target.checked })}
                />
                Pause new learning
              </label>
              <div className="card-body" style={{ marginTop: 8 }}>
                Retrieval keeps working; no new records are written.
              </div>
            </div>

            <div className="sec-label">Records · {memory.length}</div>
            {!loaded && <div className="card-body">Loading…</div>}
            {loaded && memory.length === 0 && (
              <div className="card-body">
                No records yet. Enable memory, or add a note you want HYDRO to keep.
              </div>
            )}
            {memory.map((m) => (
              <div className="mem-row" key={m.id}>
                <div className="mem-body">
                  {editing === m.id ? (
                    <input
                      className="field"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveEdit(m.id);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      aria-label="Correct this memory"
                    />
                  ) : (
                    m.content
                  )}
                  <div className="mem-meta">
                    {m.type}
                    {(m as MemoryRecord & { project?: string }).project
                      ? ` · project ${(m as MemoryRecord & { project?: string }).project}`
                      : " · all projects"}{" "}
                    · {m.source} · {new Date(m.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {editing === m.id ? (
                  <button type="button" className="ghost-btn" onClick={() => void saveEdit(m.id)}>
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      setEditing(m.id);
                      setEditText(m.content);
                    }}
                    aria-label="Edit memory record"
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-btn"
                  data-danger="true"
                  onClick={() => void removeRecord(m.id)}
                  aria-label="Delete memory record"
                >
                  Delete
                </button>
              </div>
            ))}

            <div className="sec-label">Add a note</div>
            <input
              className="field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Something HYDRO should remember"
              onKeyDown={(e) => {
                if (e.key === "Enter") void addNote();
              }}
            />
            <div style={{ display: "flex", gap: 7, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" className="ghost-btn" onClick={() => void addNote()} disabled={busy || !note.trim()}>
                Save note
              </button>
              <button type="button" className="ghost-btn" onClick={exportMemory} disabled={!memory.length}>
                Export
              </button>
              <button
                type="button"
                className="ghost-btn"
                data-danger="true"
                onClick={() => void clearAll()}
                disabled={!memory.length}
              >
                Clear all
              </button>
            </div>
          </>
        )}

        {tab === "voice" && <VoiceSettings voice={voice} />}

        {tab === "providers" && (
          <>
            <div className="panel-title">Provider status</div>
            <div className="card-body" style={{ marginBottom: 10 }}>
              Probed live. A provider is only routed to when it answered.
            </div>
            {providers.map((p) => (
              <div className="mem-row" key={p.id}>
                <span className="agent-dot" data-s={p.online ? "complete" : "failed"} />
                <div className="mem-body">
                  {p.label}
                  <div className="mem-meta">
                    {!p.configured
                      ? "not configured"
                      : p.online
                        ? `online · ${p.latencyMs ?? "?"}ms`
                        : `offline — ${p.note ?? "unavailable"}`}
                  </div>
                </div>
              </div>
            ))}

            <div className="sec-label">Tools</div>
            <div className="card-body">
              web evidence {capabilities?.search ? "ready" : "off"} · speech-to-text{" "}
              {capabilities?.stt ? "ready" : "off"} · speech synthesis{" "}
              {capabilities?.tts ? "ready" : "off"}
            </div>

            <div className="sec-label">Models by routing score</div>
            {models.map((m) => (
              <div className="card" key={m.id}>
                <div className="card-head">
                  <span className="card-title">{m.label}</span>
                  <span className="badge" data-tone={m.online ? "ok" : "warn"}>
                    {m.online ? "online" : "offline"}
                  </span>
                </div>
                <div className="card-body">
                  score {m.score.toFixed(3)} · reliability {m.reliability.toFixed(2)} ·{" "}
                  {m.samples} sample{m.samples === 1 ? "" : "s"}
                  {m.failures ? ` · ${m.failures} failed` : ""} · ${m.pricePerMTok}/Mtok
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "abilities" && (
          <>
            <div className="panel-title">What this build can do</div>
            <div className="card-body" style={{ marginBottom: 10 }}>
              {ABILITY_STATE_LABEL.verified}: {abilityCounts().verified} · needs hardware:{" "}
              {abilityCounts().device} · partial: {abilityCounts().partial} · needs configuration:{" "}
              {abilityCounts().config} · not built: {abilityCounts().missing}
            </div>
            {ABILITIES.map((ability) => (
              <div className="card" key={ability.id}>
                <div className="card-head">
                  <span className="card-title">
                    {ability.id}. {ability.name}
                  </span>
                  <span
                    className="badge"
                    data-tone={
                      ability.state === "verified"
                        ? "ok"
                        : ability.state === "missing"
                          ? "warn"
                          : "info"
                    }
                  >
                    {ABILITY_STATE_LABEL[ability.state]}
                  </span>
                </div>
                <div className="card-body">{ability.dependency}</div>
                <div className="card-body" style={{ opacity: 0.7, marginTop: 5 }}>
                  Where: {ability.surface}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "evolution" && (
          <>
            <div className="panel-title">Controlled evolution</div>
            <div className="card-body" style={{ marginBottom: 12 }}>
              Proposals are derived from recorded telemetry only. Nothing is applied until you
              approve it, and every approval can be rolled back.
            </div>
            {proposals.length === 0 && (
              <div className="card-body">No proposals yet — not enough recorded calls.</div>
            )}
            {proposals.map((p) => (
              <div className="card" key={p.id}>
                <div className="card-head">
                  <span className="card-title">{p.title}</span>
                  <span
                    className="badge"
                    data-tone={p.status === "approved" ? "ok" : p.status === "rejected" ? "warn" : "info"}
                  >
                    {p.status}
                  </span>
                </div>
                <div className="card-body">{p.rationale}</div>
                <div className="card-body" style={{ marginTop: 6, opacity: 0.75 }}>
                  Evidence: {p.evidence}
                </div>
                {p.status === "proposed" && (
                  <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                    <button type="button" className="ghost-btn" onClick={() => void decide(p.id, "approve")}>
                      Approve
                    </button>
                    <button type="button" className="ghost-btn" onClick={() => void decide(p.id, "reject")}>
                      Reject
                    </button>
                  </div>
                )}
                {p.status === "approved" && (
                  <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                    <button type="button" className="ghost-btn" data-danger="true" onClick={() => void decide(p.id, "rollback")}>
                      Roll back
                    </button>
                  </div>
                )}
              </div>
            ))}

            <div className="sec-label">Audit log</div>
            {audit.length === 0 && <div className="card-body">Empty.</div>}
            {audit.map((a, i) => (
              <div className="mem-row" key={i}>
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
