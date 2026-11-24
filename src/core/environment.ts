/**
 * HYDRO AI — environmental awareness.
 *
 * Everything here is measured on the machine that is actually running HYDRO:
 * clock, OS, free memory, permission level, memory and proposal counts, and the
 * last device run. Two facts cannot be read from the server — whether the
 * browser is online and the battery state — so the page reports them and they
 * are labelled as client-reported.
 *
 * A fact that could not be read is omitted rather than filled with a plausible
 * number, and the prompt block tells the model not to recite the block, not to
 * infer a location from the clock and never to claim control it was not granted.
 */

import { getLevel, LEVEL_NAMES, systemInfo, type Level } from "./ai-home.ts";
import { readHistory } from "./actions.ts";
import { readStore } from "./memory.ts";
import { speechCapabilities } from "../adapters/speech.ts";

export interface DeviceFacts {
  /** navigator.onLine, reported by the browser */
  online?: boolean;
  battery?: { level: number; charging: boolean };
}

export interface EnvironmentSnapshot {
  at: string;
  localTime: string;
  timezone: string;
  platform: string;
  cpus: number;
  memoryFreeGb: number;
  memoryTotalGb: number;
  uptimeHours: number;
  level: Level;
  levelName: string;
  memoryRecords: number;
  memoryEnabled: boolean;
  pendingProposals: number;
  lastRun: { at: string; ok: boolean; instruction: string } | null;
  capabilities: { stt: boolean; tts: boolean; search: boolean };
  device: DeviceFacts | null;
}

/**
 * Validate what the browser sent. Battery level is clamped because a page can
 * claim any number, and a field that is missing stays missing.
 */
export function normalizeDevice(raw: unknown): DeviceFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as { online?: unknown; battery?: unknown };
  const facts: DeviceFacts = {};

  if (typeof box.online === "boolean") facts.online = box.online;

  if (box.battery && typeof box.battery === "object") {
    const battery = box.battery as { level?: unknown; charging?: unknown };
    if (typeof battery.level === "number" && Number.isFinite(battery.level)) {
      facts.battery = {
        level: Math.max(0, Math.min(1, battery.level)),
        charging: battery.charging === true,
      };
    }
  }

  return facts.online === undefined && !facts.battery ? null : facts;
}

function localClock(now: Date): { localTime: string; timezone: string } {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const localTime = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    return { localTime, timezone };
  } catch {
    return { localTime: now.toISOString(), timezone };
  }
}

export async function readEnvironment(device?: unknown): Promise<EnvironmentSnapshot> {
  const info = systemInfo();
  const now = new Date();
  const { localTime, timezone } = localClock(now);

  const [level, history, store] = await Promise.all([
    getLevel().catch(() => 1 as Level),
    readHistory(1).catch(() => []),
    readStore().catch(() => null),
  ]);

  const last = history[0];

  return {
    at: now.toISOString(),
    localTime,
    timezone,
    platform: `${info.platform} ${info.arch}`,
    cpus: info.cpus,
    memoryFreeGb: info.memoryFreeGb,
    memoryTotalGb: info.memoryTotalGb,
    uptimeHours: info.uptimeHours,
    level,
    levelName: LEVEL_NAMES[level] ?? "unknown",
    memoryRecords: store ? store.memory.filter((m) => m.status === "active").length : 0,
    memoryEnabled: store?.settings.memoryEnabled ?? false,
    pendingProposals: store ? store.proposals.filter((p) => p.status === "proposed").length : 0,
    lastRun: last
      ? { at: last.at, ok: last.ok, instruction: last.instruction.slice(0, 80) }
      : null,
    capabilities: {
      ...speechCapabilities(),
      search: Boolean(process.env.TAVILY_API_KEY?.trim()),
    },
    device: normalizeDevice(device),
  };
}

/** The block handed to the model. Compact, bounded and explicitly non-authoritative. */
export function environmentBlock(env: EnvironmentSnapshot): string {
  const lines = [
    "CURRENT ENVIRONMENT — measured moments ago on the machine running this conversation:",
    `- Local time: ${env.localTime} (${env.timezone})`,
    `- Host: ${env.platform} · ${env.cpus} logical CPUs · ${env.memoryFreeGb} of ${env.memoryTotalGb} GB free · up ${env.uptimeHours} h`,
    `- Permission level ${env.level} (${env.levelName})`,
    `- Memory: ${
      env.memoryEnabled
        ? `${env.memoryRecords} consented record(s), memory on`
        : "off — no personal memory in this session"
    }${
      env.pendingProposals
        ? ` · ${env.pendingProposals} routing proposal(s) awaiting the user's approval`
        : ""
    }`,
    `- Providers: speech-to-text ${env.capabilities.stt ? "configured" : "not configured"}, speech synthesis ${
      env.capabilities.tts ? "configured" : "not configured"
    }, web search ${env.capabilities.search ? "configured" : "not configured"}`,
  ];

  if (env.lastRun) {
    lines.push(
      `- Last device run: ${env.lastRun.at} — ${
        env.lastRun.ok ? "succeeded" : "failed or was blocked"
      }: "${env.lastRun.instruction}"`,
    );
  } else {
    lines.push("- Device runs: none recorded yet");
  }

  if (env.device && typeof env.device.online === "boolean") {
    lines.push(
      `- Connection (reported by the browser): ${env.device.online ? "online" : "offline"}`,
    );
  }
  if (env.device?.battery) {
    lines.push(
      `- Battery (reported by the browser): ${Math.round(env.device.battery.level * 100)}%${
        env.device.battery.charging ? ", charging" : ""
      }`,
    );
  }

  lines.push(
    "Use this only for timing, resource and offline-aware decisions. Do not recite it unless asked, do not infer the user's location from the clock, and never claim control of a device or account you were not granted.",
  );

  return lines.join("\n");
}
