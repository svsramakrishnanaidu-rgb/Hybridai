"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Prosody } from "@/core/emotion";
import {
  CORE_STATE,
  DEFAULT_SETTINGS,
  InteractionController,
  type Describe,
  type InteractionEvent,
  type InteractionFrame,
  type InteractionSettings,
  type VisibleCues,
} from "./interaction/controller";

const PREFS_KEY = "hydro.interaction.v1";

interface Options {
  /** measured TTS amplitude 0…1 */
  audio?: () => number;
  /** visible cues from the camera, already measured */
  visible?: () => VisibleCues;
}

export interface DescribeStore {
  subscribe: (listener: () => void) => () => void;
  get: () => Describe;
}

/**
 * Owns the interaction controller for the page.
 *
 * The controller is advanced by the hologram's render loop through `frameRef`,
 * so a 60 fps face never re-renders React. The readout is a tiny external store
 * polled four times a second; only the components that subscribe re-render.
 */
export function useInteraction(options: Options = {}) {
  const controller = useMemo(() => new InteractionController(), []);
  const frameRef = useRef<((dt: number) => InteractionFrame) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [settings, setSettings] = useState<InteractionSettings>(DEFAULT_SETTINGS);
  // The hologram's visual state follows the controller, so the core and the
  // face can never describe different things. It changes a few times a turn.
  const [core, setCore] = useState<string>(() => CORE_STATE[controller.state]);

  const describeRef = useRef<Describe>(controller.describe());
  const listenersRef = useRef<Set<() => void>>(new Set());

  const refresh = useCallback(() => {
    const next = controller.describe();
    const prev = describeRef.current;
    if (next.core !== prev.core) setCore(next.core);
    if (
      next.state === prev.state &&
      next.expression === prev.expression &&
      Math.abs(next.intensity - prev.intensity) < 0.02
    ) {
      return;
    }
    describeRef.current = next;
    for (const listener of listenersRef.current) listener();
  }, [controller]);

  useEffect(() => {
    const id = window.setInterval(refresh, 400);
    return () => window.clearInterval(id);
  }, [refresh]);

  const store = useMemo<DescribeStore>(
    () => ({
      subscribe: (listener: () => void) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
      get: () => describeRef.current,
    }),
    [],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<InteractionSettings>;
      const next: InteractionSettings = {
        expressiveness:
          typeof parsed.expressiveness === "number"
            ? Math.max(0, Math.min(1, parsed.expressiveness))
            : DEFAULT_SETTINGS.expressiveness,
        mirror: typeof parsed.mirror === "boolean" ? parsed.mirror : true,
      };
      controller.setSettings(next);
      setSettings(next);
    } catch {
      /* storage blocked — defaults apply for this session */
    }
  }, [controller]);

  const updateSettings = useCallback(
    (patch: Partial<InteractionSettings>) => {
      setSettings((prev) => {
        const next: InteractionSettings = {
          ...prev,
          ...patch,
          expressiveness: Math.max(0, Math.min(1, patch.expressiveness ?? prev.expressiveness)),
        };
        controller.setSettings(next);
        try {
          localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [controller],
  );

  const push = useCallback(
    (event: InteractionEvent) => {
      controller.push(event);
      refresh();
    },
    [controller, refresh],
  );

  const beginSpeech = useCallback(
    (text: string) => {
      controller.beginSpeech(text);
    },
    [controller],
  );

  const endSpeech = useCallback(() => {
    controller.endSpeech();
  }, [controller]);

  const prosody = useCallback((): Prosody => controller.prosody(), [controller]);

  frameRef.current = (dt: number) => {
    const current = optionsRef.current;
    return controller.sample(dt, {
      audio: current.audio?.() ?? 0,
      visible: current.visible?.(),
    });
  };

  return {
    controller,
    frameRef,
    push,
    beginSpeech,
    endSpeech,
    prosody,
    settings,
    updateSettings,
    /** hologram visual state, derived from the same controller */
    core,
    /** live readout of behaviour state + simulated expression */
    store,
  };
}

export type InteractionApi = ReturnType<typeof useInteraction>;
