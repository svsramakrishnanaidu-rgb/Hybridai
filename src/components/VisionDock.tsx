"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { IconCamera, IconEye, IconHand, IconScan, IconClose } from "@/components/Icons";
import AffectPanel from "@/components/AffectPanel";
import type { AffectApi } from "@/lib/useAffect";
import type { InteractionApi } from "@/lib/useInteraction";
import type { VisionApi } from "@/lib/useVision";
import { GESTURE_LABELS, type VisionStatus } from "@/lib/vision/types";
import { SIGHT_BUDGET } from "@/lib/vision/sight";
import { LIVE_MODES, modeSpec, type LiveMode } from "@/lib/interaction/live";
import type { LiveSessionApi } from "@/lib/useLiveSession";
import { selectionLabel, type SelectionRect } from "@/lib/vision/selection";

const STATUS_LABEL: Record<VisionStatus, string> = {
  idle: "camera off",
  requesting: "asking permission",
  loading: "loading models",
  live: "tracking",
  denied: "permission denied",
  unsupported: "unsupported",
  error: "unavailable",
};

interface Props {
  vision: VisionApi;
  interaction: InteractionApi;
  affect: AffectApi;
  onObserve: () => void;
  /** one explicit reading pass over the current frame */
  onReadText: () => void;
  observeBusy: boolean;
  onPrompt: (text: string) => void;
  liveMode: LiveMode;
  onModeChange: (mode: LiveMode) => void;
  liveSession: LiveSessionApi;
  liveCommand: { label: string; gesture: string; confidence: number; at: number } | null;
  onEmergencyStop: () => void;
  replying: boolean;
  /** framed region of the preview, normalised to the frame */
  selection: SelectionRect | null;
  onSelection: (rect: SelectionRect | null) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  /** one authorised question about the selected region */
  onAskSelection: () => void;
  /** OCR output from the last reading pass, and its measured note */
  ocrText: string;
  ocrNote: string | null;
  onCopyText: () => void;
  onTranslateText: () => void;
  onSaveOcr: () => void;
  onOpenNotes: () => void;
  onFreeze: () => void;
  onUnfreeze: () => void;
}

function Readout({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "idle";
}) {
  return (
    <div className="vision-row" data-tone={tone ?? "idle"}>
      <span className="vision-key">{label}</span>
      <span className="vision-val">{value}</span>
    </div>
  );
}

export default function VisionDock({
  vision,
  interaction,
  affect,
  onObserve,
  onReadText,
  observeBusy,
  onPrompt,
  liveMode,
  onModeChange,
  liveSession,
  liveCommand,
  onEmergencyStop,
  replying,
  selection,
  onSelection,
  selectMode,
  onSelectMode,
  onAskSelection,
  ocrText,
  ocrNote,
  onCopyText,
  onTranslateText,
  onSaveOcr,
  onOpenNotes,
  onFreeze,
  onUnfreeze,
}: Props) {
  // Selection is handled on the artwork stage; this panel toggles it.
  // Narrow layouts start collapsed so the panel never sits on the hologram.
  // The first client render must match the server render, so the collapse is
  // applied in an effect instead of reading window.innerWidth during render
  // (that branch caused a hydration mismatch on every narrow screen).
  const [open, setOpen] = useState(false);
  const [teachOpen, setTeachOpen] = useState(false);
  const [poseName, setPoseName] = useState("");
  const [poseCommand, setPoseCommand] = useState("");
  const [poseSig, setPoseSig] = useState<number[] | null>(null);
  const [poseNote, setPoseNote] = useState<string | null>(null);

  const capturePose = () => {
    const sig = vision.capturePose();
    if (!sig) {
      setPoseNote("No hand detected — hold one hand clearly in frame.");
      return;
    }
    setPoseSig(sig);
    setPoseNote("Pose captured. Give it a name and a command, then save.");
  };

  const savePose = async () => {
    if (!poseSig) return;
    const res = await fetch("/api/personal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "gesture", name: poseName, command: poseCommand, signature: poseSig }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setPoseNote(data.error ?? "Could not save that gesture.");
      return;
    }
    await vision.refreshPersonal();
    setPoseNote("Saved. Show the pose again to run its command.");
    setPoseName("");
    setPoseCommand("");
    setPoseSig(null);
  };
  const { status, live, busy, prefs, events, scene, sightNote, quality, commentCount, lastCall, sightCount } =
    vision;
  // subscribing here keeps ~7 Hz landmark updates out of the conversation tree
  const sample = useSyncExternalStore(vision.subscribe, vision.getSample, vision.getSample);
  const describe = useSyncExternalStore(
    interaction.store.subscribe,
    interaction.store.get,
    interaction.store.get,
  );
  const face = sample.face;
  const gazePct = Math.round(face.gazeX * 100);
  const smilePct = Math.round(face.smile * 100);
  const browPct = Math.round(face.brow * 100);
  const lastEvent = events[0] ?? null;
  const spec = modeSpec(liveMode);
  const voiceBusy = interaction.controller.speaking;

  if (!open) {
    return (
      <button
        type="button"
        className="vision-pill"
        data-live={live}
        onClick={() => setOpen(true)}
        aria-label="Open the vision panel"
      >
        <span className="vision-dot" />
        VISION · {STATUS_LABEL[status]}
      </button>
    );
  }

  return (
    <section
      className="vision-dock"
      data-live={live}
      data-face={face.present ? "yes" : "no"}
      aria-label="Camera vision and gesture tracking"
    >
      <header className="vision-head">
        <span className="vision-dot" />
        <span className="vision-title">VISION</span>
        <span className="vision-status">
          {STATUS_LABEL[status]}
          {face.present && live ? " · following you" : ""}
        </span>
        <button
          type="button"
          className="vision-mini"
          onClick={() => setOpen(false)}
          aria-label="Collapse the vision panel"
        >
          <IconClose size={12} />
        </button>
      </header>

      <div className="vision-stage-note">
        The camera preview is the artwork stage. Closing the camera releases every
        track; the frozen frame and the selection belong to that session.
      </div>

      <div className="live-block">
        <div className="live-head">
          <span className="vision-key">LIVE INTERACTION</span>
          <span className="live-state" data-live={liveSession.listening ? "true" : "false"}>
            {liveSession.listening
              ? "hands-free"
              : spec.mic
                ? "mic stopped"
                : spec.gestures
                  ? "gesture signals"
                  : "manual signals"}
          </span>
        </div>
        <select
          className="vision-field"
          value={liveMode}
          onChange={(e) => onModeChange(e.target.value as LiveMode)}
          aria-label="Interaction mode"
        >
          {LIVE_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="vision-copy">{spec.hint}</p>

        <Readout
          label="microphone"
          value={
            liveSession.status === "listening"
              ? `listening · ${liveSession.utterances} command${liveSession.utterances === 1 ? "" : "s"}`
              : liveSession.status === "starting"
                ? "asking permission"
                : liveSession.status === "denied"
                  ? "permission denied"
                  : liveSession.status === "error"
                    ? "unavailable"
                    : spec.mic
                      ? "stopped"
                      : "off in this mode"
          }
          tone={liveSession.status === "listening" ? "ok" : liveSession.status === "denied" ? "warn" : "idle"}
        />
        {liveSession.listening && (
          <span className="live-level" aria-hidden="true">
            <span style={{ width: `${Math.round(liveSession.level * 100)}%` }} />
          </span>
        )}
        <Readout
          label="auto-submit"
          value={spec.autoSubmit ? "on · no send button" : "off"}
          tone={spec.autoSubmit ? "ok" : "idle"}
        />
        <Readout
          label="hearing"
          value={
            liveSession.transcribing
              ? "transcribing…"
              : liveSession.transcript
                ? `“${liveSession.transcript}”`
                : liveSession.dropped
                  ? `ignored · ${liveSession.dropped}`
                  : liveSession.listening
                    ? "waiting for speech"
                    : "—"
          }
          tone={liveSession.transcript || liveSession.transcribing ? "ok" : "idle"}
        />
        <Readout
          label="last command"
          value={
            liveCommand
              ? `${liveCommand.label} · ${Math.round(liveCommand.confidence * 100)}%`
              : "none yet"
          }
          tone={liveCommand ? "ok" : "idle"}
        />
        <Readout
          label="response"
          value={replying ? "answering" : voiceBusy ? "speaking" : "idle"}
          tone={replying || voiceBusy ? "ok" : "idle"}
        />
        <Readout
          label="hologram"
          value={`${describe.label.toLowerCase()} · ${describe.core.toLowerCase()} (synced)`}
          tone={live ? "ok" : "idle"}
        />
        {liveSession.error && <p className="vision-error">{liveSession.error}</p>}
        <button type="button" className="vision-btn" data-tone="off" onClick={onEmergencyStop}>
          Emergency stop
        </button>
      </div>

      {live ? (
        <div className="vision-grid">
          <Readout
            label="face"
            value={face.present ? "tracked" : "not in frame"}
            tone={face.present ? "ok" : "idle"}
          />
          <Readout
            label="gaze"
            value={face.present ? `${gazePct > 0 ? "+" : ""}${gazePct}%` : "—"}
            tone={face.present ? "ok" : "idle"}
          />
          <Readout
            label="hands"
            value={
              sample.hands.count
                ? `${sample.hands.count}${sample.hands.gesture ? ` · ${GESTURE_LABELS[sample.hands.gesture]}` : ""}`
                : "none visible"
            }
            tone={sample.hands.count ? "ok" : "idle"}
          />
          <Readout
            label="body"
            value={
              sample.pose.present
                ? sample.pose.settle > 0.5
                  ? "upper body · settled lower (approx)"
                  : Math.abs(sample.pose.lean) > 0.35
                    ? `upper body · leaning ${sample.pose.lean > 0 ? "left" : "right"} (approx)`
                    : "upper body"
                : "—"
            }
            tone={sample.pose.present ? "ok" : "idle"}
          />
          <Readout
            label="throughput"
            value={`${sample.fps} fps · ${sample.inferenceMs} ms`}
            tone={sample.fps >= 12 ? "ok" : "warn"}
          />
          <Readout
            label="blink"
            value={face.blink > 0.5 ? "closed" : "open"}
            tone={face.present ? "ok" : "idle"}
          />
          <Readout
            label="faces"
            value={sample.faces ? `${sample.faces} in frame` : "none"}
            tone={sample.faces ? "ok" : "idle"}
          />
          <Readout
            label="visible cues"
            value={face.present ? `smile ${smilePct}% · brow ${browPct}%` : "—"}
            tone={face.present ? "ok" : "idle"}
          />
        </div>
      ) : (
        <p className="vision-copy">
          {vision.detail ??
            "Enable the camera and HYDRO can follow your movement, read gestures and look at what you show it."}
        </p>
      )}

      {live && (
        <div className="vision-row" data-tone="ok">
          <span className="vision-key">HYDRO</span>
          <span className="vision-val">
            {describe.label} · {describe.expression} (simulated)
          </span>
        </div>
      )}

      {lastEvent && (
        <div className="vision-event">
          <IconHand size={12} />
          <span>{GESTURE_LABELS[lastEvent.name]}</span>
          <span className="vision-conf">{Math.round(lastEvent.confidence * 100)}%</span>
        </div>
      )}

      <AffectPanel affect={affect} onPrompt={onPrompt} />

      <div className="vision-actions">
        <button
          type="button"
          className="vision-btn"
          data-tone={live ? "off" : "on"}
          onClick={vision.toggle}
          disabled={busy}
        >
          <IconCamera size={13} />
          {busy ? "starting…" : live ? "Stop camera" : "Start camera"}
        </button>
        {live && (
          <button type="button" className="vision-btn" onClick={() => void vision.switchCamera()}>
            <IconScan size={13} />
            Switch
          </button>
        )}
      </div>

      {live && (
        <div className="vision-actions">
          <button
            type="button"
            className="vision-btn"
            data-tone={selectMode || selection ? "on" : "off"}
            onClick={() => {
              if (selection && !selectMode) {
                onSelection(null);
                return;
              }
              onSelectMode(!selectMode);
            }}
            title="Frame the object, diagram or part of a document you want HYDRO to look at"
          >
            <IconScan size={13} />
            {selection ? "Clear selection" : selectMode ? "Cancel selecting" : "Select area"}
          </button>
          <button
            type="button"
            className="vision-btn"
            data-tone={vision.frozen ? "on" : "off"}
            onClick={() => (vision.frozen ? onUnfreeze() : onFreeze())}
            title="Hold this frame: read a page that moves, or ask about it again"
          >
            <IconEye size={13} />
            {vision.frozen ? "Unfreeze" : "Freeze frame"}
          </button>
        </div>
      )}

      {live && selection && (
        <div className="vision-actions">
          <button type="button" className="vision-observe" onClick={onAskSelection} disabled={observeBusy}>
            <IconEye size={13} />
            {observeBusy ? "looking…" : `Ask about ${selectionLabel(selection)}`}
          </button>
        </div>
      )}

      {(ocrText || ocrNote) && (
        <div className="vision-scene vision-ocr">
          <span className="vision-key">read text · copies, translates or saves</span>
          {ocrNote && <p className="vision-scene-note">{ocrNote}</p>}
          {ocrText && <p style={{ whiteSpace: "pre-wrap" }}>{ocrText}</p>}
          {ocrText && (
            <div className="vision-actions">
              <button type="button" className="vision-btn" onClick={onCopyText}>
                Copy
              </button>
              <button type="button" className="vision-btn" onClick={onTranslateText} disabled={observeBusy || !vision.frozen}>
                Translate
              </button>
              <button type="button" className="vision-btn" onClick={onSaveOcr}>
                Save note
              </button>
              <button type="button" className="vision-btn" onClick={onOpenNotes}>
                Notes
              </button>
            </div>
          )}
          {ocrText && !vision.frozen && (
            <p className="vision-scene-note">Freeze the frame to translate it — the text must come from a stable image.</p>
          )}
        </div>
      )}

      {live && (
        <div className="vision-actions">
          <button
            type="button"
            className="vision-btn"
            data-tone={prefs.sight ? "on" : "off"}
            aria-pressed={prefs.sight}
            onClick={() => vision.updatePrefs({ sight: !prefs.sight })}
            title="When the scene changes, HYDRO looks at one frame. Up to 30 looks per session."
          >
            <IconEye size={13} />
            {prefs.sight ? "Continuous sight on" : "Continuous sight"}
          </button>
        </div>
      )}

      {live && (
        <label className="vision-setting-row">
          <span>When the scene changes</span>
          <select
            className="vision-field"
            value={prefs.proactive}
            onChange={(e) =>
              vision.updatePrefs({ proactive: e.target.value as typeof prefs.proactive })
            }
          >
            <option value="off">Do nothing</option>
            <option value="assist">Look silently</option>
            <option value="comment">Comment in the chat</option>
          </select>
        </label>
      )}

      {live && (
        <div className="vision-actions">
          <button
            type="button"
            className="vision-observe"
            onClick={onObserve}
            disabled={observeBusy}
          >
            <IconEye size={13} />
            {observeBusy ? "looking…" : "Ask what I see"}
          </button>
          <button
            type="button"
            className="vision-btn"
            onClick={onReadText}
            disabled={observeBusy}
            title="One reading pass: transcribes only the text that is actually legible"
          >
            <IconScan size={13} />
            Read text
          </button>
        </div>
      )}

      {(scene || sightNote) && (
        <div className="vision-scene">
          <span className="vision-key">
            scene
            {scene
              ? ` · ${new Date(scene.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${
                  vision.sightCount ? ` · ${vision.sightCount} look${vision.sightCount === 1 ? "" : "s"}` : ""
                }`
              : ""}
          </span>
          {scene && <p>{scene.text}</p>}
          {quality && quality.level !== "good" && (
            <p className="vision-scene-note">
              measured light: {Math.round(quality.mean * 100)}% · contrast{" "}
              {Math.round(quality.contrast * 100)}%
            </p>
          )}
          {sightNote && <p className="vision-scene-note">{sightNote}</p>}
          {commentCount > 0 && (
            <p className="vision-scene-note">
              {commentCount} observation{commentCount === 1 ? "" : "s"} shared in the chat
            </p>
          )}
        </div>
      )}

      {live && (
        <div className="vision-teach">
          <button
            type="button"
            className="vision-btn"
            onClick={() => setTeachOpen((v) => !v)}
          >
            <IconHand size={12} />
            {teachOpen ? "Close gesture teaching" : "Learn a gesture"}
          </button>
          {teachOpen && (
            <div className="vision-teach-body">
              <button type="button" className="vision-btn" onClick={capturePose}>
                {poseSig ? "Recapture pose" : "Capture pose"}
              </button>
              <input
                className="vision-field"
                value={poseName}
                onChange={(e) => setPoseName(e.target.value)}
                placeholder="gesture name"
              />
              <input
                className="vision-field"
                value={poseCommand}
                onChange={(e) => setPoseCommand(e.target.value)}
                placeholder="command, e.g. list my projects"
              />
              <button
                type="button"
                className="vision-btn"
                onClick={() => void savePose()}
                disabled={!poseSig || poseName.trim().length < 2 || poseCommand.trim().length < 3}
              >
                Save gesture
              </button>
              {poseNote && <p className="vision-copy">{poseNote}</p>}
            </div>
          )}
        </div>
      )}

      {vision.error && <p className="vision-error">{vision.error}</p>}

      <details className="vision-settings">
        <summary>Diagnostics</summary>
        <Readout label="camera" value={`${STATUS_LABEL[status]}${live ? " · tracks active" : ""}`} tone={live ? "ok" : "idle"} />
        <Readout
          label="latest frame"
          value={scene ? `${Math.max(0, Math.round((Date.now() - scene.at) / 1000))} s old` : "none analysed"}
          tone={scene ? "ok" : "idle"}
        />
        <Readout
          label="backend look"
          value={
            lastCall
              ? `${lastCall.frames ?? 0} frame(s) · ${lastCall.model ?? "no model"}${
                  lastCall.latencyMs ? ` · ${lastCall.latencyMs} ms` : ""
                }`
              : "no look yet"
          }
          tone={lastCall?.error ? "warn" : lastCall ? "ok" : "idle"}
        />
        <Readout
          label="vision model"
          value={lastCall?.error ? "failed" : lastCall ? "answered" : "not called"}
          tone={lastCall?.error ? "warn" : lastCall ? "ok" : "idle"}
        />
        <Readout label="detector" value={sample.quality} tone={sample.quality === "landmarks" ? "ok" : "warn"} />
        <Readout label="sight budget" value={`${sightCount}/${SIGHT_BUDGET.maxObservations}`} />
        {lastCall?.error && <p className="vision-error">{lastCall.error}</p>}
        {vision.error && <p className="vision-error">{vision.error}</p>}
      </details>

      <details className="vision-settings">
        <summary>Interaction settings</summary>
        <label>
          <span>Eye-contact sensitivity</span>
          <input
            type="range"
            min={0.4}
            max={1.8}
            step={0.1}
            value={prefs.sensitivity}
            onChange={(e) => vision.updatePrefs({ sensitivity: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>Motion intensity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.motion}
            onChange={(e) => vision.updatePrefs({ motion: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>Expression intensity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={interaction.settings.expressiveness}
            onChange={(e) =>
              interaction.updateSettings({ expressiveness: Number(e.target.value) })
            }
          />
        </label>
        <label className="vision-check">
          <input
            type="checkbox"
            checked={interaction.settings.mirror}
            onChange={(e) => interaction.updateSettings({ mirror: e.target.checked })}
          />
          <span>Mirror visible expression</span>
        </label>
        <label className="vision-check">
          <input
            type="checkbox"
            checked={prefs.gestures}
            onChange={(e) => vision.updatePrefs({ gestures: e.target.checked })}
          />
          <span>Gesture controls</span>
        </label>
        <p className="vision-privacy">
          Landmarks are computed in this tab. No recording, no identity check, no biometrics
          stored. A still frame leaves the device only when you press “Ask what I see”, or
          while continuous sight is on — then at most one frame every 12 s when the scene
          actually changes, capped at 30 looks. The text of the last look is dropped the
          moment the camera stops.
        </p>
      </details>
    </section>
  );
}
