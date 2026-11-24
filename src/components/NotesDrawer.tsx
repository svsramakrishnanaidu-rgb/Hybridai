"use client";

import { useCallback, useEffect, useState } from "react";
import { IconClose, IconCopy } from "@/components/Icons";

/**
 * Project notes.
 *
 * Notes are Markdown files in HYDRO's own home, so this list is the real
 * filesystem, not a client cache. Opening one reads it back from the server —
 * which is also how "save this" proves it saved something.
 */

interface NoteRecord {
  path: string;
  project: string;
  title: string;
  bytes: number;
  modifiedAt: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** path to open immediately after a save */
  focusPath?: string | null;
  /** bump to reload the list */
  refreshKey?: number;
  project: string;
  onProjectChange: (project: string) => void;
}

export default function NotesDrawer({
  open,
  onClose,
  focusPath = null,
  refreshKey = 0,
  project,
  onProjectChange,
}: Props) {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allProjects, setAllProjects] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const url = allProjects ? "/api/notes" : `/api/notes?project=${encodeURIComponent(project)}`;
      const res = await fetch(url);
      const data = (await res.json()) as { notes?: NoteRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not list notes");
      setNotes(Array.isArray(data.notes) ? data.notes : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list notes");
    } finally {
      setBusy(false);
    }
  }, [allProjects, project]);

  const openNote = useCallback(async (path: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/notes?path=${encodeURIComponent(path)}`);
      const data = (await res.json()) as { content?: string; title?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not open that note");
      setOpenPath(path);
      setContent(data.content ?? "");
      setTitle(data.title ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that note");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    if (focusPath) void openNote(focusPath);
  }, [focusPath, load, open, openNote, refreshKey]);

  const remove = async (path: string) => {
    const res = await fetch(`/api/notes?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not remove that note");
      return;
    }
    if (openPath === path) {
      setOpenPath(null);
      setContent("");
    }
    await load();
  };

  if (!open) return null;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Project notes">
        <div className="inspector-head">
          <span className="inspector-title">Notes</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close notes">
            <IconClose size={15} />
          </button>
        </div>

        <div className="card">
          <label className="toggle" style={{ gap: 8 }}>
            <span>Project</span>
            <input
              className="field"
              value={project}
              onChange={(e) => onProjectChange(e.target.value)}
              placeholder="general"
              style={{ flex: 1, minWidth: 0 }}
              aria-label="Active project name"
            />
          </label>
          <label className="toggle" style={{ marginTop: 8 }}>
            <span className="switch" data-on={allProjects} />
            <input
              type="checkbox"
              hidden
              checked={allProjects}
              onChange={(e) => setAllProjects(e.target.checked)}
            />
            Show all projects
          </label>
          <div className="card-body" style={{ marginTop: 8 }}>
            Say &ldquo;save this as DHRUVA notes&rdquo; after an answer, or &ldquo;save this&rdquo;. Files live
            in the AI workspace under projects/{project || "general"}/notes.
          </div>
        </div>

        {error && <div className="err">{error}</div>}

        {openPath ? (
          <>
            <div className="sec-label" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{title || "Note"}</span>
              <span style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(content).then(
                      () => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                      },
                      () => setError("Clipboard is blocked in this browser."),
                    );
                  }}
                >
                  <IconCopy size={11} /> {copied ? "Copied" : "Copy"}
                </button>
                <button type="button" className="ghost-btn" onClick={() => setOpenPath(null)}>
                  Back
                </button>
              </span>
            </div>
            <div className="card">
              <div className="card-body" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {content}
              </div>
              <div className="card-body" style={{ opacity: 0.6, marginTop: 8 }}>
                {openPath}
              </div>
              <button
                type="button"
                className="ghost-btn"
                data-danger="true"
                style={{ marginTop: 8 }}
                onClick={() => void remove(openPath)}
              >
                Move to trash
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="sec-label">Saved notes · {notes.length}</div>
            {busy && !notes.length && <div className="card-body">Loading…</div>}
            {!busy && !notes.length && (
              <div className="card-body">
                No notes in this project yet. Ask HYDRO something, then say &ldquo;save this&rdquo;.
              </div>
            )}
            {notes.map((note) => (
              <div className="mem-row" key={note.path}>
                <button
                  type="button"
                  className="mem-body"
                  onClick={() => void openNote(note.path)}
                  style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }}
                >
                  {note.title}
                  <div className="mem-meta">
                    {note.project} · {Math.max(1, Math.round(note.bytes / 1024))} KB ·{" "}
                    {note.modifiedAt ? new Date(note.modifiedAt).toLocaleString() : "unknown time"}
                  </div>
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  data-danger="true"
                  onClick={() => void remove(note.path)}
                  aria-label={`Move ${note.title} to trash`}
                >
                  Trash
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
