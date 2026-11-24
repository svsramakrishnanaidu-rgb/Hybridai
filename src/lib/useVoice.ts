"use client";

/**
 * HYDRO AI — spoken answers.
 *
 * Pipeline: plan (server) → fetch sentence 0 → decode → schedule → speak, while
 * sentence 1 is already in flight and sentence 2 is requested as soon as 1 lands.
 * Speech therefore starts after the first *sentence*, not after the whole
 * answer, and the sentences are joined on one audio clock instead of restarting
 * an element each time.
 *
 * Interruption is part of the contract: any new `speak`, `stop`, or the
 * microphone cancels the in-flight requests (AbortController), stops every
 * scheduled buffer, and discards decoded audio that has not played yet. That is
 * what prevents the previous answer from talking over the next one.
 *
 * If the neural provider fails completely, the browser's own speech engine is
 * used for the same text and the status says so. It sounds worse; it is not
 * presented as the same voice.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechPlayer } from "./voice/player";
import { bcp47 } from "@/core/speech/languages";
import { DEFAULT_SPEECH_SETTINGS, normalizeSpeechSettings, type SpeechSettings } from "@/core/speech/settings";

interface PlanSegmentDto {
  index: number;
  /** the sentence's own language, so a mixed answer switches per sentence */
  language?: string;
  text: string;
  displayText: string;
}

interface PlanDto {
  language: string;
  mixed: boolean;
  voiceId: string;
  voiceNotice: string | null;
  model: string;
  fallbackChain: string[];
  notice: string | null;
  notes: string[];
  segments: PlanSegmentDto[];
  outputFormat: string;
  pauseMs: number;
  speed: number;
}

export interface VoiceStats {
  engine: "neural" | "browser" | null;
  model: string | null;
  language: string | null;
  voiceId: string | null;
  segments: number;
  spokenSegments: number;
  firstAudioMs: number | null;
  totalMs: number | null;
  notice: string | null;
  voiceNotice: string | null;
  notes: string[];
  /** the exact text sent to the synthesizer, for lip sync */
  planText: string;
  /** measured audio duration of everything scheduled, ms */
  audioMs: number | null;
}

const EMPTY_STATS: VoiceStats = {
  engine: null,
  model: null,
  language: null,
  voiceId: null,
  segments: 0,
  spokenSegments: 0,
  firstAudioMs: null,
  totalMs: null,
  notice: null,
  voiceNotice: null,
  notes: [],
  planText: "",
  audioMs: null,
};

export function useVoice() {
  const playerRef = useRef<SpeechPlayer | null>(null);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const amplitude = useRef(0);
  const tickRef = useRef<number | null>(null);

  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [stats, setStats] = useState<VoiceStats>(EMPTY_STATS);
  const [settings, setSettings] = useState<SpeechSettings>(DEFAULT_SPEECH_SETTINGS);

  const player = useCallback((): SpeechPlayer => {
    if (!playerRef.current) playerRef.current = new SpeechPlayer();
    return playerRef.current;
  }, []);

  // Preferences come from the server so every tab speaks the same way.
  useEffect(() => {
    let alive = true;
    void fetch("/api/voice/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { settings?: unknown } | null) => {
        if (!alive || !data?.settings) return;
        const next = normalizeSpeechSettings(data.settings);
        setSettings(next);
        playerRef.current?.setVolume(next.volume);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const updateSettings = useCallback(async (patch: Partial<SpeechSettings>) => {
    setSettings((prev) => {
      const next = normalizeSpeechSettings({ ...prev, ...patch });
      playerRef.current?.setVolume(next.volume);
      return next;
    });
    const res = await fetch("/api/voice/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { settings?: unknown };
    if (data.settings) setSettings(normalizeSpeechSettings(data.settings));
  }, []);

  const stopTimer = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const silence = useCallback(() => {
    stopTimer();
    playerRef.current?.stop();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    amplitude.current = 0;
    setSpeaking(false);
    setPaused(false);
    setSubtitle("");
  }, []);

  /** Stop speaking and cancel synthesis that has not arrived yet. */
  const stop = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    silence();
  }, [silence]);

  const tick = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    amplitude.current = p.amplitude();
    const active = p.active() ?? p.latest();
    if (active) {
      setSubtitle((prev) => (prev === active.displayText ? prev : active.displayText));
    }
    if (!p.isPlaying && p.remaining <= 0.05) {
      // Everything that was scheduled has finished playing.
      setSpeaking(false);
      amplitude.current = 0;
      stopTimer();
    }
  }, []);

  /** Speak one segment with the browser's own engine (fallback, not a claim of parity). */
  const browserSpeak = useCallback(
    (segments: PlanSegmentDto[], language: string, rate: number): Promise<boolean> => {
      return new Promise((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
          resolve(false);
          return;
        }
        const synth = window.speechSynthesis;
        const voices = synth.getVoices();
        const target = bcp47(language).toLowerCase();
        const voice =
          voices.find((v) => v.lang.toLowerCase() === target) ??
          voices.find((v) => v.lang.toLowerCase().startsWith(language.toLowerCase())) ??
          null;
        if (!voice && language !== "en") {
          // Without a matching voice the fallback would read Telugu with English
          // phonetics — the exact defect this build removes. Refuse instead.
          resolve(false);
          return;
        }
        synth.cancel();
        let finished = 0;
        for (const segment of segments) {
          const utterance = new SpeechSynthesisUtterance(segment.text);
          if (voice) utterance.voice = voice;
          utterance.lang = voice?.lang ?? bcp47(language);
          utterance.rate = Math.min(2, Math.max(0.5, rate));
          utterance.volume = settings.volume;
          utterance.onstart = () => {
            setSpeaking(true);
            setSubtitle(segment.displayText);
          };
          utterance.onend = () => {
            finished += 1;
            if (finished >= segments.length) {
              setSpeaking(false);
              setSubtitle("");
              resolve(true);
            }
          };
          utterance.onerror = () => {
            finished += 1;
            if (finished >= segments.length) {
              setSpeaking(false);
              resolve(false);
            }
          };
          synth.speak(utterance);
        }
        if (!segments.length) resolve(false);
      });
    },
    [settings.volume],
  );

  const speak = useCallback(
    async (
      text: string,
      prosody?: { style?: number; stability?: number; speed?: number; pauseMs?: number },
    ) => {
      const clean = text.trim();
      if (!clean) return;

      // A new utterance always wins. Nothing from the previous one survives.
      runRef.current += 1;
      const run = runRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      silence();
      setError(null);

      const startedAt = performance.now();
      const p = player();
      await p.resume();

      let plan: PlanDto;
      try {
        const res = await fetch("/api/voice/tts/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: clean, prosody }),
          signal: controller.signal,
        });
        const data = (await res.json()) as PlanDto & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not prepare speech");
        plan = data;
      } catch (err) {
        if (controller.signal.aborted || run !== runRef.current) return;
        setError(err instanceof Error ? err.message : "Could not prepare speech");
        return;
      }
      if (run !== runRef.current) return;

      setStats({
        engine: "neural",
        model: plan.model,
        language: plan.language,
        voiceId: plan.voiceId,
        segments: plan.segments.length,
        spokenSegments: 0,
        firstAudioMs: null,
        totalMs: null,
        notice: plan.notice,
        voiceNotice: plan.voiceNotice,
        notes: plan.notes,
        planText: plan.segments.map((segment) => segment.text).join(" "),
        audioMs: null,
      });

      if (!plan.segments.length) return;

      const load = (index: number): Promise<AudioBuffer> => {
        const segment = plan.segments[index]!;
        return fetch("/api/voice/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: segment.text,
            segment: true,
            language: segment.language ?? plan.language,
            voiceId: plan.voiceId,
            prosody,
            previousText: plan.segments[index - 1]?.text,
            nextText: plan.segments[index + 1]?.text,
          }),
          signal: controller.signal,
        }).then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Speech request failed (${res.status})`);
          }
          return p.decode(await res.arrayBuffer());
        });
      };

      // Two requests in flight when streaming is on: enough to hide latency,
      // bounded so a long answer never queues the whole thing. With streaming off
      // the next sentence is only requested once the current one has finished,
      // which is the old behaviour and uses less bandwidth.
      const streaming = settings.streaming;
      let next: Promise<AudioBuffer> | null = load(0);
      let spoken = 0;
      let firstAudioMs: number | null = null;
      let fallback = false;
      let fallbackReason: string | null = null;
      let audioSeconds = 0;

      for (let index = 0; index < plan.segments.length; index++) {
        if (run !== runRef.current || controller.signal.aborted) return;
        let buffer: AudioBuffer;
        try {
          buffer = await next!;
        } catch (err) {
          if (run !== runRef.current || controller.signal.aborted) return;
          if (index === 0) {
            // Nothing has been heard yet: the browser engine is a real fallback.
            fallback = true;
            fallbackReason = err instanceof Error ? err.message : null;
            break;
          }
          // A gap in the middle: report it, keep the rest of the answer.
          setError(err instanceof Error ? `${err.message} — continuing with the rest.` : "A sentence failed to synthesize.");
          next = index + 1 < plan.segments.length ? load(index + 1) : null;
          continue;
        }

        const segment = plan.segments[index]!;
        const entry = p.schedule(
          buffer,
          { index, text: segment.text, displayText: segment.displayText },
          plan.pauseMs,
        );
        if (firstAudioMs === null) {
          firstAudioMs = Math.round(performance.now() - startedAt);
          setSpeaking(true);
          stopTimer();
          tickRef.current = window.setInterval(tick, 90);
        }
        spoken += 1;
        audioSeconds += buffer.duration;
        setStats((prev) => ({
          ...prev,
          spokenSegments: spoken,
          firstAudioMs: prev.firstAudioMs ?? firstAudioMs,
          audioMs: Math.round(audioSeconds * 1000),
        }));

        if (!streaming) {
          // Wait for this sentence to finish before asking for the next one.
          await new Promise<void>((resolve) => {
            const until = entry.startAt + entry.duration;
            const check = () => {
              if (run !== runRef.current) return resolve();
              const ctx = p.context;
              if (!ctx || p.isPaused || ctx.currentTime >= until) {
                if (p.isPaused) window.setTimeout(check, 120);
                else resolve();
                return;
              }
              window.setTimeout(check, 80);
            };
            check();
          });
          if (run !== runRef.current) return;
        }

        next = index + 1 < plan.segments.length ? load(index + 1) : null;
        if (streaming && index + 2 < plan.segments.length) {
          // Warm the third one so the pipeline stays two ahead.
          void load(index + 2).catch(() => undefined);
        }
      }

      if (fallback) {
        const ok = await browserSpeak(plan.segments, plan.language, plan.speed);
        setStats((prev) => ({
          ...prev,
          engine: ok ? "browser" : null,
          notice: ok
            ? "Neural voice unavailable — using this browser's speech engine."
            : prev.notice,
          totalMs: Math.round(performance.now() - startedAt),
        }));
        if (!ok) {
          setError(
            fallbackReason ??
              plan.voiceNotice ??
              "The voice service did not return audio, and this browser has no matching local voice.",
          );
        }
        return;
      }

      setStats((prev) => ({
        ...prev,
        totalMs: Math.round(performance.now() - startedAt),
        audioMs: Math.round(audioSeconds * 1000),
      }));
    },
    [browserSpeak, player, silence, tick],
  );

  const pause = useCallback(async () => {
    await player().pause();
    setPaused(true);
  }, [player]);

  const resume = useCallback(async () => {
    await player().unpause();
    setPaused(false);
  }, [player]);

  /** Real playback analyser, for amplitude-driven artwork. */
  const getAnalyser = useCallback(() => playerRef.current?.getAnalyser() ?? null, []);

  useEffect(() => {
    return () => {
      runRef.current += 1;
      abortRef.current?.abort();
      stopTimer();
      playerRef.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  return {
    speak,
    stop,
    pause,
    resume,
    speaking,
    paused,
    error,
    amplitude,
    getAnalyser,
    subtitle,
    stats,
    settings,
    updateSettings,
  };
}

export type VoiceApi = ReturnType<typeof useVoice>;
