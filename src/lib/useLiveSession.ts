"use client";

/**
 * HYDRO AI — hands-free microphone session.
 *
 * Records only the part of the stream that actually contained speech: the
 * loudness meter runs locally at 10 Hz, and a MediaRecorder is started on the
 * first voiced frames and stopped after a measured pause. Each finished
 * utterance is transcribed by /api/voice/stt and submitted only if the policy in
 * `interaction/live.ts` accepts it (not HYDRO's own echo, not a duplicate, not
 * while a reply is already running).
 *
 * Nothing is stored: the clip is sent once for transcription and discarded. The
 * stream is closed the moment the session stops. If the mode is turned off, the
 * tracks end and the session cannot restart itself.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SPEECH, SpeechSegmenter, cleanTranscript, decideSubmit, isCancelPhrase } from "@/lib/interaction/live";

/** A session longer than this many utterances is almost certainly unattended. */
const MAX_UTTERANCES = 40;

export type MicStatus = "off" | "starting" | "listening" | "denied" | "error";

interface Options {
  /** active interaction mode id; decides whether a transcript may be sent */
  mode: string;
  /** the current mode accepts speech (privacy/manual modes do not) */
  enabled: boolean;
  /** the current mode submits finished sentences automatically */
  autoSubmit: boolean;
  /** HYDRO is speaking out loud */
  speaking: boolean;
  /** the last sentence HYDRO said, for echo rejection */
  echoText: () => string;
  /** a reply is already streaming */
  busy: () => boolean;
  /** live preview, updated as the transcript arrives */
  onTranscript: (text: string) => void;
  /** an accepted command; the caller sends it */
  onSubmit: (text: string) => void;
  /** why the last utterance was dropped, for the dashboard */
  onDropped?: (reason: string) => void;
}

export function useLiveSession(options: Options) {
  const optsRef = useRef(options);
  optsRef.current = options;

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const segmenterRef = useRef<SpeechSegmenter>(new SpeechSegmenter());
  const startedAtRef = useRef(0);
  const lastSubmittedRef = useRef<{ text: string; at: number } | null>(null);
  const utterancesRef = useRef(0);
  const aliveRef = useRef(false);

  const [status, setStatus] = useState<MicStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [utterances, setUtterances] = useState(0);
  const [dropped, setDropped] = useState<string | null>(null);

  const note = useCallback((reason: string) => {
    setDropped(reason);
    optsRef.current.onDropped?.(reason);
  }, []);

  const closeStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // Drop the partial clip: stopping the session is not a command.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    analyserRef.current = null;
    segmenterRef.current.reset();
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    aliveRef.current = false;
    closeStream();
    setStatus("off");
    setTranscript("");
    setTranscribing(false);
  }, [closeStream]);

  const transcribe = useCallback(async (blob: Blob) => {
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const res = await fetch("/api/voice/stt", { method: "POST", body: form });
      const data = (await res.json()) as { transcript?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Transcription failed.");
      const text = cleanTranscript(data.transcript ?? "");
      if (!text) {
        note("no speech detected");
        setTranscript("");
        return;
      }
      // The mode may have been switched off while the clip was transcribing.
      // Then this text must not be shown or submitted: the user ended consent.
      if (!aliveRef.current || !optsRef.current.enabled) {
        setTranscript("");
        optsRef.current.onTranscript("");
        note("microphone was turned off");
        return;
      }

      setTranscript(text);
      optsRef.current.onTranscript(text);

      // "Cancel" or "never mind" removes the command instead of sending it.
      if (isCancelPhrase(text)) {
        setTranscript("");
        optsRef.current.onTranscript("");
        note("cancelled by voice");
        return;
      }

      const decision = decideSubmit({
        text,
        mode: optsRef.current.mode,
        speaking: optsRef.current.speaking,
        echoText: optsRef.current.echoText(),
        lastSubmitted: lastSubmittedRef.current,
        now: Date.now(),
        busy: optsRef.current.busy(),
      });

      if (!decision.submit) {
        note(decision.reason === "busy" ? "reply already running" : decision.reason);
        return;
      }

      lastSubmittedRef.current = { text: decision.text, at: Date.now() };
      utterancesRef.current += 1;
      setUtterances(utterancesRef.current);
      setTranscript("");
      optsRef.current.onTranscript("");
      setDropped(null);
      optsRef.current.onSubmit(decision.text);
      if (utterancesRef.current >= MAX_UTTERANCES) {
        setError(`Automatic listening paused after ${MAX_UTTERANCES} commands this session.`);
        stop();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
      setStatus("error");
    } finally {
      setTranscribing(false);
    }
  }, [note, stop]);

  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    startedAtRef.current = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (!chunks.length) return;
      void transcribe(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    recorder.start(250);
  }, [transcribe]);

  const stopRecorder = useCallback((submit: boolean) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || recorder.state === "inactive") return;
    if (!submit) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
      chunksRef.current = [];
      return;
    }
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      aliveRef.current = false;
      closeStream();
      setStatus("off");
      setTranscript("");
      setTranscribing(false);
      setDropped(null);
      optsRef.current.onTranscript("");
      return;
    }
    if (aliveRef.current) return;

    let cancelled = false;
    const boot = async () => {
      setStatus("starting");
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error("This browser cannot measure microphone input.");
        const ctx = new Ctor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.2;
        source.connect(analyser);
        ctxRef.current = ctx;
        analyserRef.current = analyser;
        const buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));

        aliveRef.current = true;
        setStatus("listening");

        timerRef.current = window.setInterval(() => {
          if (!aliveRef.current) return;
          const node = analyserRef.current;
          if (!node) return;
          node.getFloatTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
          const rms = Math.sqrt(sum / buffer.length);
          const shown = Math.min(1, rms * 8);
          setLevel(shown);

          // While HYDRO speaks, the microphone is not listened to at all: its
          // own voice must never become the next command.
          if (optsRef.current.speaking) {
            segmenterRef.current.reset();
            if (recorderRef.current) stopRecorder(false);
            return;
          }

          const event = segmenterRef.current.push(rms, Date.now());
          if (event === "start") {
            setDropped(null);
            startRecorder();
          } else if (event === "end") {
            stopRecorder(true);
          } else if (event === "too-short") {
            stopRecorder(false);
            note("too short");
          }
        }, 100);
      } catch (err) {
        if (cancelled) return;
        const denied = err instanceof Error && err.name === "NotAllowedError";
        setStatus(denied ? "denied" : "error");
        setError(
          denied
            ? "Microphone permission was denied. Type or use the camera instead."
            : err instanceof Error
              ? err.message
              : "Microphone could not start.",
        );
        aliveRef.current = false;
      }
    };

    void boot();
    return () => {
      cancelled = true;
      aliveRef.current = false;
      closeStream();
    };
  }, [closeStream, note, options.enabled, startRecorder, stopRecorder]);

  useEffect(() => () => closeStream(), [closeStream]);

  return {
    status,
    listening: status === "listening",
    level,
    transcript,
    transcribing,
    utterances,
    dropped,
    error,
    stop,
    /** silence threshold currently used to start a recording, for the docs */
    threshold: SPEECH.startLevel,
  };
}

export type LiveSessionApi = ReturnType<typeof useLiveSession>;
