"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FaceBlendshapes } from "@/core/emotion";
import type { InteractionFrame } from "@/lib/interaction/controller";
import type { DescribeStore } from "@/lib/useInteraction";
import type { VisionSignals } from "@/lib/vision/types";
import Hud, { type HudMetric } from "./Hud";
import {
  CORE_FS,
  FULLSCREEN_VS,
  PARTICLE_FS,
  PARTICLE_VS,
  STATES,
  type HydroState,
} from "./shaders";

interface Props {
  state: HydroState;
  /** live audio amplitude 0..1, read per frame to avoid re-renders */
  audioRef?: React.RefObject<number>;
  particleCount?: number;
  /** measurements shown on the HUD plates around the core */
  metrics?: HudMetric[];
  /** per-frame camera signals, read without triggering React renders */
  visionRef?: React.RefObject<VisionSignals>;
  /** user setting: 0 = nearly still, 1 = full motion */
  motion?: number;
  /**
   * Activity ping. The host sets it to 1 when the user types or acts; the
   * render loop consumes it and lets it decay, so React never re-renders at
   * keystroke speed just to drive the shader.
   */
  activityRef?: React.RefObject<number>;
  /**
   * Advances the interaction controller and returns this frame's expression,
   * mouth shape and posture. Called inside the render loop, never from React
   * state, so a 60 fps face costs no re-renders.
   */
  frameRef?: React.RefObject<((dtMs: number) => InteractionFrame) | null>;
  /** simulated expression label, subscribed without re-rendering the app */
  expressionStore?: DescribeStore;
}

function ExpressionTag({ store }: { store: DescribeStore }) {
  const describe = useSyncExternalStore(store.subscribe, store.get, store.get);
  return (
    <span className="state-expression" title="Simulated expression — not a measurement of feeling">
      · {describe.expression}
    </span>
  );
}

const FACE_KEYS: Array<keyof FaceBlendshapes> = [
  "browRaise",
  "browLower",
  "lidWide",
  "squint",
  "smile",
  "frown",
  "noseWrinkle",
  "mouthPress",
  "lipStretch",
  "pucker",
  "jaw",
  "cheek",
];

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // Without this the view silently drops to the CSS fallback and the reason
    // is impossible to find from the outside.
    console.error(
      `[hologram] ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader failed to compile:\n` +
        gl.getShaderInfoLog(sh),
    );
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(`[hologram] program failed to link:\n` + gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

export default function Hologram({
  state,
  audioRef,
  particleCount = 900,
  metrics = [],
  visionRef,
  motion = 1,
  activityRef,
  frameRef,
  expressionStore,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [supported, setSupported] = useState(true);
  const stateRef = useRef<HydroState>(state);
  stateRef.current = state;
  const motionRef = useRef(motion);
  motionRef.current = motion;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      setSupported(false);
      return;
    }

    const coreProg = program(gl, FULLSCREEN_VS, CORE_FS);
    const partProg = program(gl, PARTICLE_VS, PARTICLE_FS);
    if (!coreProg || !partProg) {
      setSupported(false);
      return;
    }

    // fullscreen triangle
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const quadLoc = gl.getAttribLocation(coreProg, "aPos");

    // particle seeds
    const seeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) seeds[i] = Math.random() * 1000;
    const partBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    const seedLoc = gl.getAttribLocation(partProg, "aSeed");

    const U = {
      res: gl.getUniformLocation(coreProg, "uRes"),
      time: gl.getUniformLocation(coreProg, "uTime"),
      pointer: gl.getUniformLocation(coreProg, "uPointer"),
      amp: gl.getUniformLocation(coreProg, "uAmp"),
      hue: gl.getUniformLocation(coreProg, "uHue"),
      ring: gl.getUniformLocation(coreProg, "uRing"),
      audio: gl.getUniformLocation(coreProg, "uAudio"),
      gaze: gl.getUniformLocation(coreProg, "uGaze"),
      attention: gl.getUniformLocation(coreProg, "uAttention"),
      blink: gl.getUniformLocation(coreProg, "uBlink"),
      mouth: gl.getUniformLocation(coreProg, "uMouth"),
      presence: gl.getUniformLocation(coreProg, "uPresence"),
      scan: gl.getUniformLocation(coreProg, "uScan"),
      energy: gl.getUniformLocation(coreProg, "uEnergy"),
      face: gl.getUniformLocation(coreProg, "uFace"),
      mouthTone: gl.getUniformLocation(coreProg, "uMouthTone"),
      mouthForm: gl.getUniformLocation(coreProg, "uMouthForm"),
      posture: gl.getUniformLocation(coreProg, "uPosture"),
    };
    const PU = {
      time: gl.getUniformLocation(partProg, "uTime"),
      audio: gl.getUniformLocation(partProg, "uAudio"),
      amp: gl.getUniformLocation(partProg, "uAmp"),
      dpr: gl.getUniformLocation(partProg, "uDpr"),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let renderScale = 1;
    let raf = 0;
    let running = true;
    let pointer = { x: 0, y: 0 };
    let pointerTarget = { x: 0, y: 0 };

    const current = {
      amp: STATES[state].amp,
      hue: STATES[state].hue,
      ring: STATES[state].ring,
      speed: STATES[state].speed,
    };
    let phase = 0;
    let smoothAudio = 0;
    let energy = 0;
    let lastDraw = 0;
    // camera signals are smoothed in the render loop, never in React state
    const vis = { x: 0, y: 0, attention: 0, blink: 0, mouth: 0, presence: 0, scan: 0 };
    // expression + posture are eased toward the controller's targets, which is
    // what makes transitions between emotional states smooth rather than snapped
    const expr: FaceBlendshapes = {
      browRaise: 0, browLower: 0, lidWide: 0, squint: 0, smile: 0, frown: 0,
      noseWrinkle: 0, mouthPress: 0, lipStretch: 0, pucker: 0, jaw: 0, cheek: 0,
    };
    const pose = { pitch: 0, roll: 0, sway: 0, breath: 0.5 };
    // written by the render loop, read by draw()
    let live: InteractionFrame | null = null;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2) * renderScale;
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const onPointer = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      pointerTarget = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    const onLeave = () => {
      pointerTarget = { x: 0, y: 0 };
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const rect = wrap.getBoundingClientRect();
      pointerTarget = {
        x: ((t.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((t.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    wrap.addEventListener("pointermove", onPointer, { passive: true });
    wrap.addEventListener("pointerleave", onLeave);
    wrap.addEventListener("touchmove", onTouch, { passive: true });

    const onVisibility = () => {
      running = !document.hidden;
      if (running) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisibility);

    let last = performance.now();
    let avgFrame = 16;

    const draw = () => {
      gl.clear(gl.COLOR_BUFFER_BIT);

      // particles behind the core
      gl.useProgram(partProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
      gl.enableVertexAttribArray(seedLoc);
      gl.vertexAttribPointer(seedLoc, 1, gl.FLOAT, false, 0, 0);
      gl.uniform1f(PU.time, phase);
      gl.uniform1f(PU.audio, smoothAudio);
      gl.uniform1f(PU.amp, current.amp);
      gl.uniform1f(PU.dpr, dpr);
      gl.drawArrays(gl.POINTS, 0, particleCount);

      // holographic core
      gl.useProgram(coreProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(quadLoc);
      gl.vertexAttribPointer(quadLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(U.res, width, height);
      gl.uniform1f(U.time, phase);
      gl.uniform2f(U.pointer, pointer.x, pointer.y);
      gl.uniform1f(U.amp, current.amp);
      gl.uniform1f(U.hue, current.hue);
      gl.uniform1f(U.ring, current.ring);
      gl.uniform1f(U.audio, smoothAudio);
      gl.uniform2f(U.gaze, vis.x, vis.y);
      gl.uniform1f(U.attention, vis.attention);
      gl.uniform1f(U.blink, vis.blink);
      gl.uniform1f(
        U.mouth,
        Math.max(vis.mouth, smoothAudio * 0.5, live?.mouth.jaw ?? 0),
      );
      gl.uniform1f(U.presence, vis.presence);
      gl.uniform1f(U.scan, vis.scan);
      gl.uniform1f(U.blink, Math.max(vis.blink, live?.blink ?? 0));
      gl.uniform1f(U.energy, energy);
      gl.uniform4f(U.face, expr.browRaise, expr.browLower, expr.lidWide, expr.squint);
      gl.uniform4f(U.mouthTone, expr.smile, expr.frown, expr.noseWrinkle, expr.mouthPress);
      gl.uniform4f(U.mouthForm, expr.lipStretch, expr.pucker, 0, expr.cheek);
      gl.uniform4f(U.posture, pose.pitch, pose.roll, pose.sway, pose.breath);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min(64, now - last);
      last = now;
      avgFrame = avgFrame * 0.92 + dt * 0.08;

      // adaptive quality: protect interactivity on weak GPUs. Skipped under
      // reduced motion, where the throttled draw rate is not a GPU problem.
      if (!reduceMotion && avgFrame > 26 && renderScale > 0.62) {
        renderScale = Math.max(0.6, renderScale - 0.06);
        resize();
      } else if (!reduceMotion && avgFrame < 13 && renderScale < 1) {
        renderScale = Math.min(1, renderScale + 0.03);
        resize();
      }

      // camera attention, damped so nothing snaps when tracking flickers
      const vs = visionRef?.current;
      const ease = (from: number, to: number, k: number) => from + (to - from) * k;
      vis.x = ease(vis.x, vs?.gazeX ?? 0, 0.075);
      vis.y = ease(vis.y, vs?.gazeY ?? 0, 0.075);
      vis.attention = ease(vis.attention, vs?.attention ?? 0, 0.05);
      vis.blink = ease(vis.blink, vs?.blink ?? 0, 0.35);
      vis.mouth = ease(vis.mouth, vs?.mouth ?? 0, 0.3);
      vis.presence = ease(vis.presence, vs?.presence ?? 0, 0.05);
      vis.scan = ease(vis.scan, vs?.scan ?? 0, 0.08);

      const target = STATES[stateRef.current];
      const gain = 0.35 + 0.65 * Math.max(0, Math.min(1, motionRef.current));
      current.amp += (target.amp * gain - current.amp) * 0.055;
      current.hue += (target.hue - current.hue) * 0.05;
      current.ring += (target.ring - current.ring) * 0.05;
      current.speed += (target.speed - current.speed) * 0.05;

      // reduced motion keeps a calm, slow-time loop instead of a frozen frame
      phase += (dt / 1000) * current.speed * (reduceMotion ? 0.28 : 1);
      pointer.x += (pointerTarget.x - pointer.x) * 0.06;
      pointer.y += (pointerTarget.y - pointer.y) * 0.06;

      const rawAudio = audioRef?.current ?? 0;
      smoothAudio += (rawAudio - smoothAudio) * 0.25;

      // interaction controller: expression, visemes and posture for this frame
      live = frameRef?.current?.(dt) ?? null;
      if (live) {
        const faceK = 1 - Math.exp(-dt / 85);
        for (const key of FACE_KEYS) {
          expr[key] += (live.face[key] - expr[key]) * faceK;
        }
        const poseK = 1 - Math.exp(-dt / 140);
        pose.pitch += (live.posture.pitch - pose.pitch) * poseK;
        pose.roll += (live.posture.roll - pose.roll) * poseK;
        pose.sway += (live.posture.sway - pose.sway) * poseK;
        pose.breath += (live.posture.breath - pose.breath) * poseK;
      }

      // consume the host's activity ping, then let the energy fade on its own
      if (activityRef && activityRef.current > 0.5) {
        energy = 1;
        activityRef.current = 0;
      }
      energy *= 0.975;

      if (reduceMotion) {
        if (now - lastDraw >= 120) {
          draw();
          lastDraw = now;
        }
      } else {
        draw();
      }
      raf = requestAnimationFrame(frame);
    };

    // Reduced motion is handled inside the loop (throttled draws, slow time) so
    // a state change is still visible and the core never appears frozen.
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      wrap.removeEventListener("pointermove", onPointer);
      wrap.removeEventListener("pointerleave", onLeave);
      wrap.removeEventListener("touchmove", onTouch);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(partBuf);
      gl.deleteProgram(coreProg);
      gl.deleteProgram(partProg);
      // Deliberately do NOT call WEBGL_lose_context here. React runs this effect
      // twice (mount → cleanup → mount) on the same canvas, and a lost context
      // makes the second getContext("webgl2") return null — which silently
      // swapped the animated shader core for the static CSS fallback.
    };
      }, [activityRef, audioRef, frameRef, particleCount, visionRef]);

  return (
    <div className="hologram" ref={wrapRef}>
      {supported ? (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`HYDRO hologram — ${STATES[state]?.label ?? "Idle"}`}
        />
      ) : (
        <div className="hologram-fallback" role="img" aria-label="HYDRO hologram" />
      )}

      <Hud metrics={metrics} visible={state !== "SLEEPING" && state !== "OFFLINE"} />

      <div className="state-readout" data-busy={state !== "IDLE" && state !== "SLEEPING"}>
        <span className="state-dot" />
        <span>{STATES[state]?.label ?? "Idle"}</span>
        {expressionStore && <ExpressionTag store={expressionStore} />}
      </div>
    </div>
  );
}
