"use client";

import { useEffect, useRef, useState } from "react";
import {
  mountHydroMotion,
  type ConversationPhase,
  type VisionPhase,
} from "@/lib/motion/hydroMotion";
import {
  normalizeSelection,
  selectionLabel,
  tapSelection,
  type SelectionRect,
} from "@/lib/vision/selection";

/**
 * The layered artwork stage.
 *
 * Three independent visual layers:
 *   1. backdrop  — flames, hair, tattooed hands (`--bg-*`)
 *   2. portrait  — the bust cut-out with its own breathing (`--ai-*`)
 *   3. heart     — a separate alpha cut-out whose light is driven by real audio
 *
 * The interface never draws into the artwork; the status, selection and
 * controls are real DOM elements above it. The whole art stack is hidden from
 * assistive technology.
 */

interface Props {
  phase: ConversationPhase;
  visionPhase: VisionPhase;
  statusLabel: string;
  visionStatus: string;
  mode: "welcome" | "conversation";
  expanded: boolean;
  onToggleExpanded: () => void;
  getMicAnalyser: () => AnalyserNode | null;
  getPlaybackAnalyser: () => AnalyserNode | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  frozen: { dataUrl: string } | null;
  selection: SelectionRect | null;
  selectMode: boolean;
  onSelection: (rect: SelectionRect | null) => void;
  onSelectMode: (on: boolean) => void;
  onStopVision: () => void;
  onSwitchCamera: () => void;
  visionBusy: boolean;
}

export default function ArtStage({
  phase,
  visionPhase,
  statusLabel,
  visionStatus,
  mode,
  expanded,
  onToggleExpanded,
  getMicAnalyser,
  getPlaybackAnalyser,
  videoRef,
  frozen,
  selection,
  selectMode,
  onSelection,
  onSelectMode,
  onStopVision,
  onSwitchCamera,
  visionBusy,
}: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef({ phase, getMicAnalyser, getPlaybackAnalyser });
  stateRef.current = { phase, getMicAnalyser, getPlaybackAnalyser };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    return mountHydroMotion(stage, () => {
      const current = stateRef.current;
      return {
        phase: current.phase,
        microphoneAnalyser: current.getMicAnalyser(),
        playbackAnalyser: current.getPlaybackAnalyser(),
      };
    });
  }, []);

  // Selection uses the same normalised rectangle as the vision engine. The
  // live preview is mirrored, the frozen frame is not, so the mapping flips.
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragLatest = useRef<SelectionRect | null>(null);
  const [dragRect, setDragRect] = useState<SelectionRect | null>(null);

  const mirror = !frozen;
  const toSource = (point: { x: number; y: number }) =>
    mirror ? { x: 1 - point.x, y: point.y } : point;
  const toDisplay = (rect: SelectionRect): SelectionRect =>
    mirror ? { ...rect, x: 1 - rect.x - rect.w } : rect;

  const pointOf = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return toSource({
      x: (event.clientX - bounds.left) / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) / Math.max(1, bounds.height),
    });
  };

  const box = dragRect ?? selection;
  const boxView = box ? toDisplay(box) : null;
  const cameraLive = visionPhase === "live" || visionPhase === "starting";

  return (
    <section
      ref={stageRef}
      className="hydro-stage"
      data-phase={phase}
      data-vision={visionPhase}
      data-mode={mode}
      data-expanded={expanded ? "true" : "false"}
      data-select={selectMode ? "true" : "false"}
      aria-label="HYDRO artwork"
    >
      <div className="hydro-backdrop" aria-hidden="true">
        <img className="art art-desktop" src="/art/hydro-scene.webp" alt="" draggable={false} />
        <img
          className="art art-mobile"
          src="/art/hydro-scene-mobile.webp"
          alt=""
          draggable={false}
        />
        <div className="hydro-flames">
          <img className="art art-desktop" src="/art/hydro-flames.webp" alt="" draggable={false} />
          <img
            className="art art-mobile"
            src="/art/hydro-flames-mobile.webp"
            alt=""
            draggable={false}
          />
        </div>
      </div>

      <div className="hydro-avatar" aria-hidden="true">
        <div className="hydro-avatar-body">
          <img className="art art-desktop" src="/art/hydro-avatar.webp" alt="" draggable={false} />
          <img
            className="art art-mobile"
            src="/art/hydro-avatar-mobile.webp"
            alt=""
            draggable={false}
          />
          <div className="hydro-filaments" />
          <div className="hydro-heart">
            <img className="art art-desktop" src="/art/hydro-heart.webp" alt="" draggable={false} />
            <img
              className="art art-mobile"
              src="/art/hydro-heart-mobile.webp"
              alt=""
              draggable={false}
            />
            <span className="hydro-heart-glow" />
          </div>
        </div>
      </div>

      {/* Vision keeps HYDRO's state independent: the camera can be live while
          HYDRO is speaking. The photo fades in only once a usable frame exists. */}
      <video
        ref={videoRef}
        className="stage-video"
        data-on={visionPhase === "live" ? "true" : "false"}
        muted
        playsInline
        aria-hidden="true"
      />
      {frozen && (
        <img
          className="stage-frozen"
          src={frozen.dataUrl}
          alt="Frozen camera frame"
          draggable={false}
        />
      )}

      <div className="stage-status" aria-live="polite">
        <span className="status-dot" data-phase={phase} />
        <span className="status-name">Assistant</span>
        <span className="status-div" />
        <span className="status-phase">{statusLabel}</span>
        {visionPhase !== "off" && (
          <>
            <span className="status-div" />
            <span className="status-vision">Camera · {visionStatus}</span>
          </>
        )}
      </div>

      {cameraLive && (
        <div className="stage-camera-actions">
          <button type="button" className="stage-chip" onClick={onSwitchCamera} disabled={visionBusy}>
            Switch camera
          </button>
          <button type="button" className="stage-chip" data-tone="danger" onClick={onStopVision}>
            Stop vision
          </button>
        </div>
      )}

      {visionPhase === "live" && (
        <div className="stage-mini" aria-hidden="true">
          <img className="art art-desktop" src="/art/hydro-scene.webp" alt="" />
          <img className="art art-mobile" src="/art/hydro-scene-mobile.webp" alt="" />
        </div>
      )}

      {mode === "conversation" && (
        <button
          type="button"
          className="stage-expand"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          {expanded ? "Show conversation" : "Expand portrait"}
        </button>
      )}

      {selectMode && (
        <div
          className="select-surface"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStart.current = pointOf(event);
            dragLatest.current = null;
            setDragRect(null);
          }}
          onPointerMove={(event) => {
            if (!dragStart.current) return;
            const next = normalizeSelection(dragStart.current, pointOf(event));
            if (next) {
              dragLatest.current = next;
              setDragRect(next);
            }
          }}
          onPointerUp={(event) => {
            if (!dragStart.current) return;
            const start = dragStart.current;
            dragStart.current = null;
            const framed = dragLatest.current ?? normalizeSelection(start, pointOf(event));
            dragLatest.current = null;
            setDragRect(null);
            onSelection(framed ?? tapSelection(pointOf(event).x, pointOf(event).y));
            onSelectMode(false);
          }}
        />
      )}

      {selectMode && <span className="select-hint">Drag or tap the area you mean</span>}

      {boxView && (
        <span
          className="stage-selection"
          style={{
            left: `${boxView.x * 100}%`,
            top: `${boxView.y * 100}%`,
            width: `${boxView.w * 100}%`,
            height: `${boxView.h * 100}%`,
          }}
        >
          <span className="stage-selection-tag">
            {dragRect ? "framing…" : `selection · ${selectionLabel(box!)}`}
          </span>
        </span>
      )}
    </section>
  );
}
