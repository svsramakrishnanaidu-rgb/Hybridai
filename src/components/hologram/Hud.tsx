"use client";

import type { ReactNode } from "react";
import {
  IconBolt,
  IconBrain,
  IconChart,
  IconChip,
  IconCube,
  IconDatabase,
  IconGear,
  IconGlobe,
  IconLayers,
  IconNetwork,
  IconPlay,
  IconShield,
  IconSpark,
  IconWave,
} from "@/components/Icons";

/**
 * The HUD around the hologram core.
 *
 * Every plate is bound to a measurement from the running system — provider
 * probes, the last run's telemetry or the memory store. A plate with no data
 * yet renders dim and says so; nothing here animates a number it does not have.
 */

export interface HudMetric {
  key: string;
  label: string;
  /** 0..1, or negative when there is nothing measured yet */
  value: number;
  detail: string;
}

const ICONS: Record<string, ReactNode> = {
  core: <IconChip size={13} />,
  reasoning: <IconNetwork size={13} />,
  learning: <IconLayers size={13} />,
  memory: <IconDatabase size={13} />,
  performance: <IconBolt size={13} />,
  security: <IconShield size={13} />,
  "multi-agent": <IconNetwork size={13} />,
  analysis: <IconChart size={13} />,
  decision: <IconGear size={13} />,
  creativity: <IconSpark size={13} />,
  voice: <IconWave size={13} />,
  execution: <IconPlay size={13} />,
};

function Plate({ metric }: { metric: HudMetric }) {
  const idle = metric.value < 0;
  const pct = idle ? 5 : Math.max(5, Math.min(100, Math.round(metric.value * 100)));
  return (
    <div className="hud-card" data-idle={idle} title={`${metric.label} — ${metric.detail}`}>
      <div className="hud-card-in">
        <span className="hud-ico">{ICONS[metric.key] ?? <IconChip size={13} />}</span>
        <span className="hud-body">
          <span className="hud-label">{metric.label}</span>
          <span className="hud-track">
            <span className="hud-fill" style={{ width: `${pct}%` }} />
          </span>
        </span>
      </div>
    </div>
  );
}

const NODES: Array<{ pos: string; icon: ReactNode; label: string }> = [
  { pos: "tl", icon: <IconGlobe size={15} />, label: "Evidence sources" },
  { pos: "tr", icon: <IconBrain size={15} />, label: "Model routing" },
  { pos: "bl", icon: <IconWave size={15} />, label: "Voice I/O" },
  { pos: "br", icon: <IconCube size={15} />, label: "Tool execution" },
];

interface Props {
  metrics: HudMetric[];
  /** hidden once the conversation starts so the core is not crowded */
  visible: boolean;
}

export default function Hud({ metrics, visible }: Props) {
  if (!visible) return null;
  const left = metrics.slice(0, 6);
  const right = metrics.slice(6, 12);

  return (
    <div className="hud" aria-hidden="false">
      <div className="hud-col" data-side="left">
        {left.map((m) => (
          <Plate key={m.key} metric={m} />
        ))}
      </div>

      <div className="hud-col" data-side="right">
        {right.map((m) => (
          <Plate key={m.key} metric={m} />
        ))}
      </div>

      {NODES.map((n) => (
        <div className="hud-node" data-pos={n.pos} key={n.pos} title={n.label}>
          {n.icon}
        </div>
      ))}
    </div>
  );
}
