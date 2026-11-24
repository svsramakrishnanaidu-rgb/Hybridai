"use client";

import { useEffect, useState } from "react";

/**
 * Live system pulse for the hologram HUD.
 *
 * Reads the same probe data the Providers panel uses, so the plates around the
 * core report measurements rather than invented motion. Polls on a slow
 * interval because probes cost a real inference call each.
 */

export interface PulseHealth {
  id: string;
  label: string;
  configured: boolean;
  online: boolean;
  latencyMs: number | null;
  note: string | null;
}

export interface PulseSystem {
  memoryRecords: number;
  proposals: number;
  memoryEnabled: boolean;
  samples: number;
  failures: number;
}

export interface Pulse {
  capabilities: { stt: boolean; tts: boolean; search: boolean };
  health: PulseHealth[];
  system: PulseSystem;
  ready: boolean;
}

const EMPTY: Pulse = {
  capabilities: { stt: false, tts: false, search: false },
  health: [],
  system: { memoryRecords: 0, proposals: 0, memoryEnabled: false, samples: 0, failures: 0 },
  ready: false,
};

const INTERVAL_MS = 45_000;

export function usePulse(): Pulse {
  const [pulse, setPulse] = useState<Pulse>(EMPTY);

  useEffect(() => {
    const ctrl = new AbortController();
    let timer = 0;

    const load = async () => {
      try {
        const res = await fetch("/api/providers", { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as {
          providers?: PulseHealth[];
          capabilities?: Pulse["capabilities"];
          system?: PulseSystem;
        };
        setPulse({
          capabilities: data.capabilities ?? EMPTY.capabilities,
          health: data.providers ?? [],
          system: data.system ?? EMPTY.system,
          ready: true,
        });
      } catch {
        /* keep the last good reading */
      }
    };

    void load();
    timer = window.setInterval(() => void load(), INTERVAL_MS);

    return () => {
      ctrl.abort();
      window.clearInterval(timer);
    };
  }, []);

  return pulse;
}
