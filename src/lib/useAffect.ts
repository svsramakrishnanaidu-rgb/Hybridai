"use client";

/**
 * HYDRO AI — affect state for the page.
 *
 * Owns the user's explicit mood, the latest microphone measurements and the
 * consent-gated episode log, and turns them into a `FusedRead` on demand.
 * Nothing here runs on a timer at frame rate: the panel reads it when it
 * renders, and a slow 3-second tick only decides whether the calm palette
 * should apply.
 *
 * Episodes live in localStorage. They are never sent to the server; the chat
 * request carries only the tone directive (tone, stress, confidence, mood).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_EPISODES,
  directiveFrom,
  fuseAffect,
  newEpisode,
  pendingFollowUp,
  rememberEpisode,
  type AffectDirective,
  type Episode,
  type FusedRead,
  type Mood,
  type SelfReport,
  type VoiceTone,
} from "@/core/affect";
import type { VisionApi } from "@/lib/useVision";

const KEY = "hydro.affect.v1";
const SELF_TTL_MS = 30 * 60_000;

interface Stored {
  consent: boolean;
  selfReport: SelfReport | null;
  episodes: Episode[];
  calm: boolean;
}

const DEFAULT_STORED: Stored = { consent: false, selfReport: null, episodes: [], calm: true };

function readStored(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STORED;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const mood = parsed.selfReport?.mood;
    return {
      consent: parsed.consent === true,
      selfReport:
        parsed.selfReport && typeof parsed.selfReport.at === "number" && mood
          ? { mood, at: parsed.selfReport.at }
          : null,
      episodes: Array.isArray(parsed.episodes)
        ? parsed.episodes
            .filter(
              (e): e is Episode =>
                Boolean(e) && typeof e.at === "number" && typeof e.id === "string",
            )
            .slice(0, MAX_EPISODES)
        : [],
      calm: parsed.calm !== false,
    };
  } catch {
    return DEFAULT_STORED;
  }
}

export interface AffectApi {
  read: () => FusedRead;
  /** payload for /api/chat, with inferred tone withheld when confidence is low */
  directive: () => AffectDirective;
  lastRead: FusedRead;
  stressNow: number;
  calmActive: boolean;
  calmPref: boolean;
  setCalm: (on: boolean) => void;
  mood: Mood | null;
  setMood: (mood: Mood | null) => void;
  consent: boolean;
  setConsent: (on: boolean) => void;
  episodes: Episode[];
  followUp: Episode | null;
  clearEpisodes: () => void;
  voiceTone: VoiceTone | null;
  setVoiceTone: (tone: VoiceTone | null) => void;
  /** called with each outgoing message; records an episode only with consent */
  observeInput: (text: string) => void;
  /** the text currently being appraised, for the panel */
  lastText: string;
}

export function useAffect({ vision }: { vision: VisionApi }): AffectApi {
  // `vision` is a fresh object every render. Depending on it made `read` a new
  // function each time, so the tick effect re-ran on every render and its
  // setState kept the loop alive ("Maximum update depth exceeded"). `getSample`
  // is a stable callback, and it is the only thing this hook needs.
  const getSample = vision.getSample;
  const [stored, setStored] = useState<Stored>(DEFAULT_STORED);
  const [voiceTone, setVoiceToneState] = useState<VoiceTone | null>(null);
  const [lastText, setLastText] = useState("");
  const [lastRead, setLastRead] = useState<FusedRead>(() => fuseAffect({}));
  const [stressNow, setStressNow] = useState(0);

  const storedRef = useRef(stored);
  storedRef.current = stored;
  const voiceRef = useRef<VoiceTone | null>(null);
  const textRef = useRef("");

  useEffect(() => {
    const loaded = readStored();
    storedRef.current = loaded;
    setStored(loaded);
  }, []);

  const persist = useCallback((next: Stored) => {
    storedRef.current = next;
    setStored(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage blocked — this session still works */
    }
  }, []);

  const read = useCallback((): FusedRead => {
    const sample = getSample();
    const face = sample.face;
    return fuseAffect({
      text: textRef.current,
      face: face.present
        ? {
            present: true,
            smile: face.smile,
            brow: face.brow,
            browDown: face.browDown,
            squint: face.squint,
            jaw: face.mouth,
            frown: face.frown,
            lean: sample.pose.lean,
            settle: sample.pose.settle,
          }
        : null,
      voice: voiceRef.current,
      selfReport: storedRef.current.selfReport,
      selfTtlMs: SELF_TTL_MS,
    });
  }, [getSample]);

  // Slow tick: enough to follow a mood shift, far too slow to cost anything.
  useEffect(() => {
    const tick = () => {
      const next = read();
      setLastRead(next);
      setStressNow(next.stress);
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [read]);

  const setMood = useCallback(
    (mood: Mood | null) => {
      const next: Stored = {
        ...storedRef.current,
        selfReport: mood ? { mood, at: Date.now() } : null,
      };
      persist(next);
      const value = read();
      setLastRead(value);
      setStressNow(value.stress);
    },
    [persist, read],
  );

  const setConsent = useCallback(
    (on: boolean) => {
      persist({ ...storedRef.current, consent: on, episodes: on ? storedRef.current.episodes : [] });
    },
    [persist],
  );

  const setCalm = useCallback(
    (on: boolean) => persist({ ...storedRef.current, calm: on }),
    [persist],
  );

  const clearEpisodes = useCallback(() => {
    persist({ ...storedRef.current, episodes: [] });
  }, [persist]);

  const setVoiceTone = useCallback((tone: VoiceTone | null) => {
    voiceRef.current = tone;
    setVoiceToneState(tone);
  }, []);

  const observeInput = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      textRef.current = clean;
      setLastText(clean);
      const value = fuseAffect({
        text: clean,
        face: null,
        voice: voiceRef.current,
        selfReport: storedRef.current.selfReport,
        selfTtlMs: SELF_TTL_MS,
      });
      setLastRead(value);
      const current = storedRef.current;
      if (!current.consent) return;
      // Nothing is written when there is no reading worth keeping.
      if (value.confidence < 0.22 && !value.mood) return;
      persist({
        ...current,
        episodes: rememberEpisode(current.episodes, newEpisode(value, clean)),
      });
    },
    [persist],
  );

  const directive = useCallback((): AffectDirective => {
    const value = read();
    const base = directiveFrom(value);
    // Low confidence means we do not get to steer the reply tone at all; only
    // an explicit self-report is still allowed through.
    if (value.confidence < 0.35 && !value.mood) {
      return { ...base, tone: "neutral" };
    }
    return base;
  }, [read]);

  const followUp = useMemo(() => pendingFollowUp(stored.episodes), [stored.episodes]);

  return {
    read,
    directive,
    lastRead,
    stressNow,
    calmActive: stored.calm && stressNow >= 0.5,
    calmPref: stored.calm,
    setCalm,
    mood: stored.selfReport?.mood ?? null,
    setMood,
    consent: stored.consent,
    setConsent,
    episodes: stored.episodes,
    followUp,
    clearEpisodes,
    voiceTone,
    setVoiceTone,
    observeInput,
    lastText,
  };
}
