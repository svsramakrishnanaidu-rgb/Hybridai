"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VisionEngine } from "@/lib/vision/engine";
import type { MatchableTemplate } from "@/lib/vision/pose";
import {
  SIGHT_BUDGET,
  PROACTIVE,
  frameQuality,
  observationQuestion,
  shouldComment,
  shouldObserve,
  signatureDelta,
  type FrameQuality,
  type ProactiveMode,
  type SceneSignature,
} from "@/lib/vision/sight";
import { cropDataUrl } from "@/lib/vision/frame";
import type { SelectionRect } from "@/lib/vision/selection";
import {
  EMPTY_SAMPLE,
  type GestureEvent,
  type VisionSample,
  type VisionSignals,
  type VisionStatus,
} from "@/lib/vision/types";

export interface VisionPrefs {
  /** 0.4 … 1.8 — how far the head turns toward a detected person */
  sensitivity: number;
  /** 0 … 1 — scale applied to hologram motion */
  motion: number;
  /** gesture events dispatched to the interface */
  gestures: boolean;
  /** continuous sight: analyse a frame when the scene materially changes */
  sight: boolean;
  /** what HYDRO does with an observation: nothing, hold it silently, or comment */
  proactive: ProactiveMode;
}

/** One observation of the scene, produced by a vision model from one frame. */
export interface SceneNote {
  text: string;
  at: number;
  model: string | null;
}

/** One measured look: what the backend actually received and answered with. */
export interface VisionCall {
  at: number;
  model: string | null;
  latencyMs: number | null;
  frames: number | null;
  error: string | null;
}

const PREFS_KEY = "hydro.vision.v1";

const DEFAULT_PREFS: VisionPrefs = {
  sensitivity: 1,
  motion: 1,
  gestures: true,
  sight: false,
  proactive: "assist",
};

interface Options {
  /** called when a fresh observation should be spoken into the conversation */
  onObservation?: (note: SceneNote) => void;
  /** true while the user is waiting on a reply */
  isBusy?: () => boolean;
}

/**
 * Owns the camera session and the on-device detector.
 *
 * The video element lives in the UI so the user can always see what the camera
 * sees. Nothing is recorded: stopping the session ends the media tracks and the
 * only image that can leave this device is the one returned by `capture()`.
 */
export function useVision(options: Options = {}) {
  const onObservationRef = useRef(options.onObservation);
  onObservationRef.current = options.onObservation;
  const isBusyRef = useRef(options.isBusy);
  isBusyRef.current = options.isBusy;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<VisionEngine | null>(null);
  const signalsRef = useRef<VisionSignals>({
    gazeX: 0,
    gazeY: 0,
    attention: 0,
    blink: 0,
    mouth: 0,
    presence: 0,
    scan: 0,
    mirrorSmile: 0,
    mirrorBrow: 0,
    mirrorSquint: 0,
  });

  // A frozen frame is what the user saw when they asked. It is held in memory
  // only, replaced on the next freeze, and dropped when the camera stops.
  const [frozen, setFrozen] = useState<{ dataUrl: string; at: number } | null>(null);
  const frozenRef = useRef<{ dataUrl: string; at: number } | null>(null);
  frozenRef.current = frozen;

  const [status, setStatus] = useState<VisionStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Samples update ~7×/s. They live in a tiny store so only the vision panel
  // re-renders — the conversation and composer stay untouched.
  const sampleRef = useRef<VisionSample>(EMPTY_SAMPLE);
  const listenersRef = useRef<Set<() => void>>(new Set());
  const [present, setPresent] = useState(false);
  const [events, setEvents] = useState<GestureEvent[]>([]);
  const [observing, setObserving] = useState(false);
  const [prefs, setPrefs] = useState<VisionPrefs>(DEFAULT_PREFS);
  const prefsRef = useRef<VisionPrefs>(DEFAULT_PREFS);
  const templatesRef = useRef<MatchableTemplate[]>([]);

  // ── continuous sight ─────────────────────────────────────────────────────
  // Only the latest observation is kept, and it is dropped when the camera
  // stops: temporary visual context never survives the session.
  const [scene, setScene] = useState<SceneNote | null>(null);
  const sceneRef = useRef<SceneNote | null>(null);
  const [sightNote, setSightNote] = useState<string | null>(null);
  const [sightCount, setSightCount] = useState(0);
  const sightBusyRef = useRef(false);
  const sightCountRef = useRef(0);
  const lastSentRef = useRef<number | null>(null);
  const lastSigRef = useRef<SceneSignature | null>(null);
  const lastCommentRef = useRef<number | null>(null);
  const commentCountRef = useRef(0);
  const [commentCount, setCommentCount] = useState(0);
  const [quality, setQuality] = useState<FrameQuality | null>(null);
  const [lastCall, setLastCall] = useState<VisionCall | null>(null);
  const noteCall = useCallback((call: Omit<VisionCall, "at">) => {
    setLastCall({ ...call, at: Date.now() });
  }, []);

  prefsRef.current = prefs;

  /** Pull the user's taught poses; called when the camera starts and after a save. */
  const refreshPersonal = useCallback(async () => {
    try {
      const res = await fetch("/api/personal");
      const data = (await res.json()) as { gestures?: MatchableTemplate[] };
      templatesRef.current = Array.isArray(data.gestures) ? data.gestures : [];
    } catch {
      templatesRef.current = [];
    }
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const getSample = useCallback(() => sampleRef.current, []);

  const publish = useCallback((next: VisionSample) => {
    sampleRef.current = next;
    setPresent((prev) => (prev === next.face.present ? prev : next.face.present));
    for (const listener of listenersRef.current) listener();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<VisionPrefs>;
      const next: VisionPrefs = {
        sensitivity:
          typeof parsed.sensitivity === "number"
            ? Math.max(0.4, Math.min(1.8, parsed.sensitivity))
            : DEFAULT_PREFS.sensitivity,
        motion:
          typeof parsed.motion === "number"
            ? Math.max(0, Math.min(1, parsed.motion))
            : DEFAULT_PREFS.motion,
        gestures: typeof parsed.gestures === "boolean" ? parsed.gestures : true,
        // continuous sight is opt-in every session, never restored silently
        sight: false,
        proactive:
          parsed.proactive === "off" || parsed.proactive === "comment"
            ? parsed.proactive
            : "assist",
      };
      prefsRef.current = next;
      setPrefs(next);
    } catch {
      /* storage blocked — defaults apply for this session */
    }
  }, []);

  const updatePrefs = useCallback((patch: Partial<VisionPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      prefsRef.current = next;
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  /**
   * Sample one frame, decide locally whether it is worth a model call, and if
   * so ask the vision endpoint about it. Nothing is stored on a server.
   */
  const observeScene = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine?.isLive || sightBusyRef.current) return;

    // Local check first: a 16×9 fingerprint costs almost nothing, a JPEG does not.
    const signature = engine.sceneSignature();
    if (!signature) return;

    // One measurement, used for both decisions below.
    const delta = signatureDelta(lastSigRef.current, signature);
    const decision = shouldObserve({
      enabled: prefsRef.current.sight,
      busy: sightBusyRef.current,
      now: Date.now(),
      lastSentAt: lastSentRef.current,
      observations: sightCountRef.current,
      delta,
    });
    if (!decision.observe) return;

    // Measured locally, before any network call: a dark or flat frame changes
    // what the model should be told, and what the user should be warned about.
    const quality = frameQuality(signature);

    const frame = engine.capture(SIGHT_BUDGET.frameWidth);
    if (!frame) return;

    sightBusyRef.current = true;
    const previousScan = signalsRef.current.scan;
    signalsRef.current.scan = 1;
    try {
      const res = await fetch("/api/vision/observe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: frame.dataUrl, question: observationQuestion(quality) }),
      });
      const data = (await res.json()) as {
        answer?: string;
        model?: string;
        latencyMs?: number;
        error?: string;
      };
      if (!res.ok || typeof data.answer !== "string") {
        throw new Error(data.error ?? "Vision observation failed.");
      }
      noteCall({ model: data.model ?? null, latencyMs: data.latencyMs ?? null, frames: 1, error: null });
      const note: SceneNote = {
        text: data.answer.slice(0, 1200),
        at: Date.now(),
        model: data.model ?? null,
      };
      sceneRef.current = note;
      setScene(note);
      // A poor frame is reported as a lighting note, not silently accepted.
      setSightNote(quality.note);
      setQuality(quality);
      lastSentRef.current = note.at;
      lastSigRef.current = signature;
      sightCountRef.current += 1;
      setSightCount(sightCountRef.current);

      if (
        shouldComment({
          mode: prefsRef.current.proactive,
          busy: isBusyRef.current?.() ?? false,
          now: note.at,
          lastCommentAt: lastCommentRef.current,
          comments: commentCountRef.current,
          delta,
        })
      ) {
        lastCommentRef.current = note.at;
        commentCountRef.current += 1;
        setCommentCount(commentCountRef.current);
        onObservationRef.current?.(note);
        if (commentCountRef.current >= PROACTIVE.maxPerSession) {
          updatePrefs({ proactive: "assist" });
          setSightNote(
            `Commenting paused after ${PROACTIVE.maxPerSession} observations this session — silent looking continues.`,
          );
        }
      }
      if (sightCountRef.current >= SIGHT_BUDGET.maxObservations) {
        updatePrefs({ sight: false });
        setSightNote(
          `Paused after ${SIGHT_BUDGET.maxObservations} observations — turn continuous sight on again to continue.`,
        );
      }
    } catch (err) {
      // A failed observation is reported once as a note, not as a camera error:
      // local tracking keeps running and the next scene change retries.
      const message =
        err instanceof Error ? err.message : "Last look failed. Local tracking is unaffected.";
      noteCall({ model: null, latencyMs: null, frames: null, error: message });
      setSightNote(err instanceof Error ? `Last look failed: ${message}` : message);
    } finally {
      sightBusyRef.current = false;
      signalsRef.current.scan = previousScan;
    }
  }, [noteCall, updatePrefs]);

  useEffect(() => {
    if (!prefs.sight || status !== "live") return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void observeScene();
    };
    const id = window.setInterval(tick, SIGHT_BUDGET.sampleIntervalMs);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [prefs.sight, status, observeScene]);

  // Ending the session ends its visual context and its frozen frame.
  useEffect(() => {
    if (status === "live") return;
    setFrozen(null);
    frozenRef.current = null;
    sceneRef.current = null;
    setScene(null);
    lastSentRef.current = null;
    lastSigRef.current = null;
    sightCountRef.current = 0;
    setSightCount(0);
    lastCommentRef.current = null;
    commentCountRef.current = 0;
    setCommentCount(0);
    setQuality(null);
    setLastCall(null);
  }, [status]);

  const ensureEngine = useCallback((): VisionEngine | null => {
    if (engineRef.current) return engineRef.current;
    const video = videoRef.current;
    if (!video) return null;
    engineRef.current = new VisionEngine(video, {
      signals: signalsRef.current,
      targetFps: 20,
      gazeGain: () => prefsRef.current.sensitivity,
      customTemplates: () => templatesRef.current,
      onSample: publish,
      onGesture: (event) => {
        if (!prefsRef.current.gestures) return;
        setEvents((prev) => [event, ...prev].slice(0, 5));
      },
      onStatus: (next, message) => {
        setStatus(next);
        setDetail(message ?? null);
        if (next === "denied" || next === "error" || next === "unsupported") {
          setError(message ?? "Camera unavailable.");
        } else if (next === "live") {
          setError(null);
        }
      },
    });
    return engineRef.current;
  }, [publish]);

  const enable = useCallback(async () => {
    setError(null);
    const engine = ensureEngine();
    if (!engine) {
      setStatus("error");
      setError("The camera preview is not mounted yet — try again in a moment.");
      return;
    }
    try {
      await refreshPersonal();
      await engine.start();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.name === "NotAllowedError"
            ? "Camera permission was denied. Text and voice still work."
            : err.message
          : "Camera could not start.",
      );
    }
  }, [ensureEngine, refreshPersonal]);

  const disable = useCallback(() => {
    engineRef.current?.stop();
    setError(null);
  }, []);

  const toggle = useCallback(() => {
    if (engineRef.current?.isLive) disable();
    else void enable();
  }, [disable, enable]);

  const switchCamera = useCallback(async () => {
    const engine = ensureEngine();
    if (!engine) return;
    try {
      await engine.switchCamera();
    } catch {
      /* status callback already reported it */
    }
  }, [ensureEngine]);

  const capture = useCallback(() => engineRef.current?.capture() ?? null, []);

  /** Hold one frame so a moving page can be read and re-asked. */
  const freeze = useCallback((): { dataUrl: string; at: number } | null => {
    const frame = engineRef.current?.capture(1100);
    if (!frame) return null;
    const next = { dataUrl: frame.dataUrl, at: Date.now() };
    frozenRef.current = next;
    setFrozen(next);
    return next;
  }, []);

  const unfreeze = useCallback(() => {
    frozenRef.current = null;
    setFrozen(null);
  }, []);

  /**
   * The frame for one authorised question: the frozen frame when one is held,
   * otherwise the live view — cropped to the selected region in either case.
   */
  const captureSelected = useCallback(
    async (rect: SelectionRect | null): Promise<{ dataUrl: string; mime: string } | null> => {
      const held = frozenRef.current;
      if (held) {
        if (!rect) return { dataUrl: held.dataUrl, mime: "image/jpeg" };
        return cropDataUrl(held.dataUrl, rect, 900);
      }
      const engine = engineRef.current;
      if (!engine?.isLive) return null;
      if (rect) return engine.captureRegion(rect, 900);
      return engine.capture();
    },
    [],
  );

  /** Snapshot the current hand pose for a user-taught gesture. */
  const capturePose = useCallback(() => engineRef.current?.currentSignature() ?? null, []);

  const markScan = useCallback((on: boolean) => {
    signalsRef.current.scan = on ? 1 : 0;
    setObserving(on);
  }, []);

  useEffect(
    () => () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  return {
    videoRef,
    signalsRef,
    status,
    detail,
    error,
    subscribe,
    getSample,
    /** true while a face is in frame — changes rarely, so it is safe as state */
    present,
    events,
    observing,
    prefs,
    updatePrefs,
    live: status === "live",
    busy: status === "requesting" || status === "loading",
    enable,
    disable,
    toggle,
    switchCamera,
    capture,
    captureSelected,
    capturePose,
    frozen,
    freeze,
    unfreeze,
    refreshPersonal,
    markScan,
    /** latest scene observation; null when nothing has been looked at */
    scene,
    sceneRef,
    sightNote,
    /** observations paid for in this camera session */
    sightCount,
    /** comments actually spoken into the thread this session */
    commentCount,
    /** measured quality of the last analysed frame */
    quality,
    /** last backend look: model, latency, frame count, error */
    lastCall,
    noteCall,
  };
}

export type VisionApi = ReturnType<typeof useVision>;
