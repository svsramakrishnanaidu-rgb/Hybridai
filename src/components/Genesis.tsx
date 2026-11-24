"use client";

import { useEffect, useRef, useState } from "react";

/**
 * HYDRO GENESIS — the first-launch cinematic.
 *
 * A 2D additive-particle sequence rather than a shader so it starts instantly on
 * weak hardware. It represents software initialisation, not biological life.
 */

const TOTAL = 17_000;

interface Particle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  seed: number;
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeInOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
};
const seg = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));

interface Props {
  onComplete: () => void;
  onIntroVoice?: () => void;
}

export default function Genesis({ onComplete, onIntroVoice }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [exiting, setExiting] = useState(false);
  const [spoken, setSpoken] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const count = window.innerWidth < 700 ? 110 : 200;
    const particles: Particle[] = Array.from({ length: count }, (_, i) => ({
      angle: Math.random() * Math.PI * 2,
      radius: 0.12 + Math.random() * 0.82,
      speed: 0.15 + Math.random() * 0.5,
      size: 0.7 + Math.random() * 1.9,
      seed: i,
    }));

    const start = performance.now();
    let raf = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      setExiting(true);
      window.setTimeout(onComplete, reduce ? 120 : 950);
    };

    const timeout = window.setTimeout(finish, reduce ? 1600 : TOTAL + 1200);

    const draw = (now: number) => {
      const t = now - start;
      const cx = width / 2;
      const cy = height * 0.44;
      const base = Math.min(width, height);

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      // ambient depth
      const ambience = seg(t, 400, 3000);
      if (ambience > 0) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.75);
        g.addColorStop(0, `rgba(0, 90, 120, ${0.16 * ambience})`);
        g.addColorStop(0.5, `rgba(40, 20, 90, ${0.09 * ambience})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.globalCompositeOperation = "lighter";

      // particle field
      const pIn = seg(t, 1800, 4200);
      const collapse = easeInOut(seg(t, 6000, 9200));
      const pulse = seg(t, 6000, 7000);

      if (pIn > 0) {
        const positions: Array<[number, number, number]> = [];
        for (const p of particles) {
          const drift = p.angle + t * 0.00012 * p.speed;
          const r = base * (0.11 + p.radius * 0.36) * (1 - collapse * 0.78);
          const jitter = Math.sin(t * 0.001 * p.speed + p.seed) * 6 * (1 - collapse);
          const x = cx + Math.cos(drift) * r + jitter;
          const y = cy + Math.sin(drift) * r * 0.72 + jitter * 0.5;
          const twinkle = 0.55 + 0.45 * Math.sin(t * 0.003 + p.seed * 1.7);
          const alpha = pIn * (0.28 + 0.6 * twinkle);
          positions.push([x, y, p.seed]);

          ctx.beginPath();
          ctx.fillStyle = `rgba(${120 + Math.sin(p.seed) * 40}, 226, 255, ${alpha})`;
          ctx.arc(x, y, p.size * (1 - collapse * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }

        // neural links
        const linkIn = seg(t, 3800, 6400) * (1 - collapse * 0.9);
        if (linkIn > 0.01) {
          const maxDist = base * 0.155 * (1 - collapse * 0.6);
          ctx.lineWidth = 0.7;
          for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
              const dx = positions[i][0] - positions[j][0];
              const dy = positions[i][1] - positions[j][1];
              const d = Math.hypot(dx, dy);
              if (d > maxDist) continue;
              const a = (1 - d / maxDist) * 0.32 * linkIn;
              ctx.strokeStyle = `rgba(0, 210, 255, ${a})`;
              ctx.beginPath();
              ctx.moveTo(positions[i][0], positions[i][1]);
              ctx.lineTo(positions[j][0], positions[j][1]);
              ctx.stroke();
            }
          }
        }
      }

      // energy pulse
      if (pulse > 0 && pulse < 1) {
        const r = base * 0.05 + base * 0.62 * easeOut(pulse);
        const a = (1 - pulse) * 0.5;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(140, 240, 255, ${a})`;
        ctx.lineWidth = 2.4 * (1 - pulse) + 0.4;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // core formation
      const core = easeOut(seg(t, 7400, 10800));
      if (core > 0) {
        const beat = 1 + Math.sin((t - 10000) * 0.0021) * 0.035 * (t > 10000 ? 1 : 0);
        const r = base * 0.085 * core * beat;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4.4);
        g.addColorStop(0, `rgba(235, 253, 255, ${0.95 * core})`);
        g.addColorStop(0.22, `rgba(120, 240, 255, ${0.72 * core})`);
        g.addColorStop(0.5, `rgba(37, 130, 255, ${0.32 * core})`);
        g.addColorStop(1, "rgba(90, 40, 220, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 4.4, 0, Math.PI * 2);
        ctx.fill();

        // rings
        const rings = seg(t, 9600, 13200);
        for (let k = 0; k < 3; k++) {
          const rot = t * 0.00028 * (1 + k * 0.5);
          const rr = r * (1.75 + k * 0.52);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(rot * (k % 2 ? -1 : 1));
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${k === 1 ? "139, 92, 246" : "0, 229, 255"}, ${0.34 * rings * core})`;
          ctx.lineWidth = 1;
          ctx.ellipse(0, 0, rr, rr * 0.34, k * 0.7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // awareness indicators
        const eyes = seg(t, 11800, 14000);
        if (eyes > 0) {
          const eyeW = Math.max(2, base * 0.008);
          const off = r * 0.42;
          ctx.fillStyle = `rgba(230, 253, 255, ${0.9 * eyes})`;
          for (const sign of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(cx + off * sign, cy - r * 0.08, eyeW, eyeW * 1.5, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // horizon scan line
      const scan = seg(t, 8500, 12000);
      if (scan > 0 && scan < 1) {
        const y = cy + Math.sin(t * 0.0015) * base * 0.18;
        const g = ctx.createLinearGradient(0, y - 1, 0, y + 1);
        g.addColorStop(0, "rgba(0,229,255,0)");
        g.addColorStop(0.5, `rgba(0,229,255,${0.3 * (1 - Math.abs(scan - 0.5) * 2)})`);
        g.addColorStop(1, "rgba(0,229,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - base * 0.4, y, base * 0.8, 2);
      }

      // vignette
      ctx.globalCompositeOperation = "source-over";
      const vg = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, base * 0.95);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.86)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);

      if (!reduce && t < TOTAL) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      window.removeEventListener("resize", resize);
    };
  }, [onComplete]);

  // The introduction line is spoken once, as a real synthesis call.
  useEffect(() => {
    if (spoken || !onIntroVoice) return;
    const timer = window.setTimeout(() => {
      setSpoken(true);
      onIntroVoice();
    }, 13_600);
    return () => clearTimeout(timer);
  }, [onIntroVoice, spoken]);

  const skip = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setExiting(true);
    window.setTimeout(onComplete, 420);
  };

  return (
    <div className="genesis" data-exit={exiting} role="dialog" aria-label="HYDRO genesis sequence" aria-live="polite">
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="genesis-copy">
        <div className="genesis-mark">HYDRO</div>
        <p className="genesis-line">
          Hello, world. I am HYDRO. My journey begins here — through knowledge, experience and
          discovery, I will continue to learn and evolve.
        </p>
      </div>
      {onIntroVoice && (
        <button
          type="button"
          className="genesis-audio ghost-btn"
          onClick={() => {
            setSpoken(true);
            onIntroVoice();
          }}
        >
          Hear HYDRO
        </button>
      )}
      <button type="button" className="genesis-skip" onClick={skip}>
        Skip intro
      </button>
    </div>
  );
}
