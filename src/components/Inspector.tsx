"use client";

import { IconClose } from "@/components/Icons";
import type { MetaEvent, TraceEvent } from "@/core/types";

interface Props {
  open: boolean;
  onClose: () => void;
  meta: MetaEvent | null;
  trace: TraceEvent[];
  live: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "queued",
  running: "running",
  complete: "complete",
  failed: "failed",
  skipped: "skipped",
};

export default function Inspector({ open, onClose, meta, trace, live }: Props) {
  return (
    <aside className="inspector" data-open={open} aria-hidden={!open} aria-label="Intelligence inspector">
      <div className="inspector-head">
        <span className="inspector-title">Intelligence</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close inspector">
          <IconClose size={15} />
        </button>
      </div>

      {!meta && !trace.length && (
        <p style={{ fontSize: 12.5, color: "rgba(148,163,184,0.8)", lineHeight: 1.6 }}>
          Send a message to see which models were selected, what evidence was used and how the
          answer was verified.
        </p>
      )}

      {trace.length > 0 && (
        <>
          <div className="sec-label">{live ? "Pipeline · live" : "Pipeline"}</div>
          {trace.map((t, i) => (
            <div className="trace-line" key={`${t.step}-${i}`}>
              <span className="trace-phase">{t.phase}</span>
              <span
                className="trace-detail"
                style={
                  t.status === "error"
                    ? { color: "#f0a0a0" }
                    : t.status === "info"
                      ? { color: "rgba(148,163,184,0.85)" }
                      : undefined
                }
              >
                {t.detail}
              </span>
            </div>
          ))}
        </>
      )}

      {meta && (
        <>
          <div className="sec-label">Run</div>
          <div className="metric-grid">
            <div className="metric">
              <div className="metric-k">Mode</div>
              <div className="metric-v" style={{ fontSize: 13, textTransform: "capitalize" }}>
                {meta.mode}
              </div>
            </div>
            <div className="metric">
              <div className="metric-k">Latency</div>
              <div className="metric-v">{(meta.latencyMs / 1000).toFixed(1)}s</div>
            </div>
            <div className="metric">
              <div className="metric-k">Model calls</div>
              <div className="metric-v">{meta.calls}</div>
            </div>
            <div className="metric">
              <div className="metric-k">Cost</div>
              <div className="metric-v">${meta.costUsd.toFixed(4)}</div>
            </div>
          </div>

          <div className="sec-label">Agents</div>
          {meta.agents.map((a) => (
            <div className="agent-row" key={a.id}>
              <span className="agent-dot" data-s={a.status} />
              <div className="agent-main">
                <div className="agent-name">
                  {a.label}
                  <span className="badge" style={{ fontSize: 9.5, padding: "1px 6px" }}>
                    {a.role}
                  </span>
                </div>
                <div className="agent-meta">
                  {STATUS_LABEL[a.status] ?? a.status}
                  {a.latencyMs != null ? ` · ${a.latencyMs}ms` : ""}
                  {a.tokens != null ? ` · ${a.tokens} tok` : ""}
                  {a.costUsd != null ? ` · $${a.costUsd.toFixed(4)}` : ""}
                </div>
                {a.note && <div className="agent-note">{a.note}</div>}
              </div>
            </div>
          ))}

          {meta.claims.length > 0 && (
            <>
              <div className="sec-label">Claim ledger</div>
              {meta.claims.slice(0, 6).map((c) => (
                <div className="claim" key={c.id}>
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      marginBottom: 4,
                      color:
                        c.status === "verified"
                          ? "#7ee7c7"
                          : c.status === "corroborated"
                            ? "#9fd0ff"
                            : "#f5c37a",
                    }}
                  >
                    {c.status}
                    {c.support > 1 ? ` · ${c.support} drafts` : ""}
                    {c.contradicts.length ? " · conflict" : ""}
                  </span>
                  <div>{c.text}</div>
                </div>
              ))}
            </>
          )}

          {meta.evidence.length > 0 && (
            <>
              <div className="sec-label">Sources</div>
              {meta.evidence.map((e, i) => (
                <a className="src" key={e.id} href={e.url} target="_blank" rel="noopener noreferrer">
                  [{i + 1}] {e.title}
                  <small>{e.url.replace(/^https?:\/\//, "").split("/")[0]}</small>
                </a>
              ))}
            </>
          )}

          {meta.notice && (
            <>
              <div className="sec-label">Notes</div>
              <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "#f0c98a", margin: 0 }}>
                {meta.notice}
              </p>
            </>
          )}

          <div className="sec-label">Request</div>
          <p style={{ fontSize: 11, color: "rgba(148,163,184,0.7)", margin: 0, fontFamily: "var(--font-mono)" }}>
            {meta.requestId}
          </p>
        </>
      )}
    </aside>
  );
}
