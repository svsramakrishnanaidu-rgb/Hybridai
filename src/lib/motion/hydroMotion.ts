/**
 * HYDRO AI — artwork depth controller.
 *
 * One requestAnimationFrame loop drives the whole stage. It reads state through
 * a getter, so switching from listening to speaking never rebuilds the audio
 * graph; it only changes which analyser is sampled.
 *
 * Layers are transformed separately:
 *   --bg-x / --bg-y   distant artwork, max 5 px
 *   --ai-x / --ai-y   foreground portrait, max 3 px, opposite direction
 *   --voice-energy    0…1, measured amplitude of the active source
 *
 * Motion is suspended for reduced-motion users, hidden tabs and an offscreen
 * stage, and every property it wrote is removed on cleanup.
 */

export type ConversationPhase =
  | "standby"
  | "requesting-mic"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type VisionPhase = "off" | "requesting" | "starting" | "live" | "error";

export interface HydroMotionState {
  phase: ConversationPhase;
  microphoneAnalyser: AnalyserNode | null;
  playbackAnalyser: AnalyserNode | null;
}

/** The analyser a phase is allowed to read. Mic and playback stay separate. */
export function analyserForPhase(state: HydroMotionState): AnalyserNode | null {
  if (state.phase === "speaking") return state.playbackAnalyser;
  if (state.phase === "listening") return state.microphoneAnalyser;
  return null;
}

/** Loudness 0…1 from a time-domain analyser. Silent when there is none. */
export function readEnergy(
  analyser: AnalyserNode | null,
  samples: Uint8Array<ArrayBuffer>,
): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = (samples[i] - 128) / 128;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

export function mountHydroMotion(
  stage: HTMLElement,
  getState: () => HydroMotionState,
): () => void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let energy = 0;
  let frame = 0;
  let lastTime = 0;
  let visible = true;
  let samples = new Uint8Array(0);

  function centerPointer() {
    targetX = 0;
    targetY = 0;
  }

  function onPointerMove(event: PointerEvent) {
    if (!finePointer.matches || event.pointerType === "touch") return;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    targetX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1));
    targetY = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1));
  }

  function tick(time: number) {
    const elapsed = lastTime ? Math.min(time - lastTime, 64) : 16;
    lastTime = time;
    const smoothing = 1 - Math.exp(-elapsed / 100);
    const state = getState();
    const analyser = analyserForPhase(state);

    if (analyser) {
      if (samples.length !== analyser.fftSize) {
        samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      }
      energy += (readEnergy(analyser, samples) - energy) * smoothing;
    } else {
      energy += (0 - energy) * smoothing;
    }

    x += (targetX - x) * smoothing;
    y += (targetY - y) * smoothing;

    stage.style.setProperty("--bg-x", `${(-5 * x).toFixed(2)}px`);
    stage.style.setProperty("--bg-y", `${(-5 * y).toFixed(2)}px`);
    stage.style.setProperty("--ai-x", `${(3 * x).toFixed(2)}px`);
    stage.style.setProperty("--ai-y", `${(3 * y).toFixed(2)}px`);
    stage.style.setProperty("--voice-energy", energy.toFixed(3));
    frame = requestAnimationFrame(tick);
  }

  function reset() {
    cancelAnimationFrame(frame);
    lastTime = 0;
    x = y = targetX = targetY = energy = 0;
    for (const key of ["--bg-x", "--bg-y", "--ai-x", "--ai-y", "--voice-energy"]) {
      stage.style.removeProperty(key);
    }
  }

  function sync() {
    reset();
    const active = visible && !document.hidden && !reduced.matches;
    stage.dataset.motion = active ? "on" : "off";
    if (active) frame = requestAnimationFrame(tick);
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  observer.observe(stage);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerleave", centerPointer);
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  sync();

  return () => {
    observer.disconnect();
    stage.removeEventListener("pointermove", onPointerMove);
    stage.removeEventListener("pointerleave", centerPointer);
    document.removeEventListener("visibilitychange", sync);
    reduced.removeEventListener("change", sync);
    reset();
    delete stage.dataset.motion;
  };
}
