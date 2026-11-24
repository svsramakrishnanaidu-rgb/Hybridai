"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Mode } from "@/core/types";
import type { VoiceTone } from "@/core/affect";
import { ToneMeter, speakingRate } from "@/lib/voice/tone";
import { IconPaperclip, IconSend, IconStop, IconClose } from "@/components/Icons";
import type { ReplyLanguage } from "@/lib/assistant/intents";

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "flash", label: "Flash", hint: "One model, fastest" },
  { id: "hybrid", label: "Hybrid", hint: "Two experts, fused" },
  { id: "deep", label: "Deep", hint: "Experts + evidence + verification" },
  { id: "council", label: "Council", hint: "Every eligible model" },
];

const LANGUAGES: Array<{ id: ReplyLanguage; label: string }> = [
  { id: "auto", label: "Auto language" },
  { id: "en", label: "English replies" },
  { id: "te", label: "తెలుగు replies" },
  { id: "mixed", label: "Mixed replies" },
];

export interface ComposerHandle {
  /** user-initiated microphone session */
  start: () => void;
  /** Done: transcribe and send */
  finish: () => void;
  /** Cancel: discard the clip */
  cancel: () => void;
}

interface Props {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onSend: (text: string) => void;
  /** a finished voice command, sent without pressing Send */
  onVoiceSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  sttEnabled: boolean;
  onListeningChange?: (listening: boolean) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  /** acoustic measurements from the just-finished recording, taken locally */
  onSpeechSample?: (sample: { tone: VoiceTone | null; durationMs: number }) => void;
  /** live transcription from the hands-free session, before it is submitted */
  liveTranscript?: string;
  /** the hands-free microphone is recording a spoken command */
  liveActive?: boolean;
  liveTranscribing?: boolean;
  replyLanguage: ReplyLanguage;
  onLanguageChange: (language: ReplyLanguage) => void;
  autoSpeak: boolean;
  onAutoSpeakChange: (on: boolean) => void;
  ttsEnabled: boolean;
  /** reports microphone lifecycle so the stage and the action row stay in sync */
  onCaptureState?: (state: "idle" | "requesting" | "listening" | "transcribing") => void;
  /** real microphone analyser, for amplitude-driven artwork */
  onAnalyserChange?: (analyser: AnalyserNode | null) => void;
}

const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    mode,
    onModeChange,
    onSend,
    onVoiceSend,
    onStop,
    busy,
    sttEnabled,
    onListeningChange,
    draft,
    onDraftChange,
    onSpeechSample,
    liveTranscript = "",
    liveActive = false,
    liveTranscribing = false,
    replyLanguage,
    onLanguageChange,
    autoSpeak,
    onAutoSpeakChange,
    ttsEnabled,
    onCaptureState,
    onAnalyserChange,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<ToneMeter | null>(null);
  const recognizedRef = useRef("");
  const recordStartRef = useRef(0);
  const recordingRef = useRef(false);
  const attemptRef = useRef(0);
  const permissionTimer = useRef<number | null>(null);

  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [attachName, setAttachName] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  // Autosize the textarea; the composer must never cover the last message.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(160, el.scrollHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > 160 ? "auto" : "hidden";
  }, [draft]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    onDraftChange("");
    setAttachName(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [busy, draft, onDraftChange, onSend]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 400_000) {
      setVoiceError("File too large — attach something under 400 KB.");
      return;
    }
    const text = await file.text().catch(() => "");
    if (!text) {
      setVoiceError("That file is not readable as text.");
      return;
    }
    setAttachName(file.name);
    setVoiceError(null);
    onDraftChange(
      `${draft}${draft ? "\n\n" : ""}Attached file "${file.name}":\n\`\`\`\n${text.slice(0, 40_000)}\n\`\`\``,
    );
  };

  const clearPermissionTimer = () => {
    if (permissionTimer.current !== null) {
      window.clearTimeout(permissionTimer.current);
      permissionTimer.current = null;
    }
  };

  const teardown = useCallback(() => {
    clearPermissionTimer();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recordingRef.current = false;
    setRecording(false);
    setStarting(false);
    onListeningChange?.(false);
    onAnalyserChange?.(null);
  }, [onAnalyserChange, onListeningChange]);

  /** Done means finished: stop the clip and transcribe it. */
  const finishRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      teardown();
      return;
    }
    recorder.stop();
  }, [teardown]);

  const cancelRecording = useCallback(() => {
    attemptRef.current += 1;
    clearPermissionTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    chunksRef.current = [];
    meterRef.current?.stop();
    meterRef.current = null;
    teardown();
    setFinalText("");
    setTranscript("");
  }, [teardown]);

  const startRecording = useCallback(async () => {
    if (recordingRef.current || starting) return;
    setVoiceError(null);
    setFinalText("");
    setTranscript("");
    setStarting(true);
    const attempt = (attemptRef.current += 1);
    try {
      // A permission prompt can stay unanswered forever; never leave the
      // interface stuck, and never start a stream the user moved on from.
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }),
        new Promise<never>((_, reject) => {
          permissionTimer.current = window.setTimeout(
            () => reject(new Error("permission-timeout")),
            20_000,
          );
        }),
      ]);
      clearPermissionTimer();
      if (attempt !== attemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const tone = meterRef.current?.stop() ?? null;
        meterRef.current = null;
        const durationMs = Date.now() - recordStartRef.current;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        teardown();
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 1200) {
          setVoiceError("That was too short to hear. Tap the mic and hold a sentence.");
          return;
        }
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "speech.webm");
          const res = await fetch("/api/voice/stt", { method: "POST", body: form });
          const data = (await res.json()) as { transcript?: string; error?: string };
          if (!res.ok) throw new Error(data.error ?? "Transcription failed");
          const text = (data.transcript ?? "").trim();
          if (!text) {
            setVoiceError("No speech detected.");
            return;
          }
          setTranscript(text);
          setFinalText(text);
          if (tone) {
            onSpeechSample?.({
              tone: { ...tone, wordsPerMinute: speakingRate(text, durationMs) },
              durationMs,
            });
          }
          onVoiceSend(text);
          window.setTimeout(() => setFinalText(""), 7000);
        } catch (err) {
          setVoiceError(err instanceof Error ? err.message : "Transcription failed.");
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start(250);
      const meter = new ToneMeter(stream);
      meterRef.current = meter;
      void meter.start();
      onAnalyserChange?.(meter.getAnalyser());
      recordStartRef.current = Date.now();
      recognizedRef.current = "";
      setStarting(false);
      setRecording(true);
      recordingRef.current = true;
      onListeningChange?.(true);
    } catch (err) {
      clearPermissionTimer();
      if (attempt !== attemptRef.current) return;
      teardown();
      setVoiceError(
        err instanceof Error && err.message === "permission-timeout"
          ? "The browser never answered the microphone prompt. Allow the microphone for this site, then tap again."
          : "Microphone access was denied. Type instead, or allow the microphone for this site.",
      );
    }
  }, [onAnalyserChange, onListeningChange, onSpeechSample, onVoiceSend, starting, teardown]);

  useImperativeHandle(
    ref,
    () => ({
      start: () => void startRecording(),
      finish: finishRecording,
      cancel: cancelRecording,
    }),
    [cancelRecording, finishRecording, startRecording],
  );

  // Report lifecycle without echoing identical states (the parent may pass an
  // inline callback, and an unconditional report would loop through setState).
  const lastCapture = useRef("idle");
  useEffect(() => {
    const key = transcribing
      ? "transcribing"
      : recording
        ? "listening"
        : starting
          ? "requesting"
          : "idle";
    if (key === lastCapture.current) return;
    lastCapture.current = key;
    onCaptureState?.(key);
  }, [onCaptureState, recording, starting, transcribing]);

  const cleanupRef = useRef(cancelRecording);
  cleanupRef.current = cancelRecording;
  useEffect(() => () => cleanupRef.current(), []);

  const stripText = transcribing
    ? "transcribing your sentence…"
    : finalText
      ? `“${finalText}”`
      : transcript
        ? `“${transcript}”`
        : starting
          ? "waiting for the microphone…"
          : recording
            ? "listening — speak Telugu or English, then tap Done"
            : liveTranscript
              ? `“${liveTranscript}”`
              : "";

  const stripState = recording
    ? "listening"
    : transcribing
      ? "transcribing"
      : starting
        ? "requesting"
        : "idle";

  return (
    <div className="hx-composer-wrap">
      {(stripText || liveTranscribing) && (
        <div className="hx-talk-strip" data-state={stripState} aria-live="polite">
          <span className="strip-phase">
            {recording ? "Listening" : transcribing ? "Transcribing" : starting ? "Microphone" : "Heard"}
          </span>
          <span className="strip-text">{stripText || "transcribing…"}</span>
          {(recording || starting) && (
            <span className="strip-actions">
              {recording && (
                <button
                  type="button"
                  className="hx-strip-btn"
                  data-primary="true"
                  onClick={finishRecording}
                >
                  Done
                </button>
              )}
              <button type="button" className="hx-strip-btn" onClick={cancelRecording}>
                Cancel
              </button>
            </span>
          )}
        </div>
      )}

      <div className="hx-composer" data-live={liveActive || recording ? "true" : "false"}>
        <button
          type="button"
          className="hx-attach"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach a text file"
          title="Attach a text file"
        >
          <IconPaperclip size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.yml,.yaml,.toml,.sql,.sh"
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <span className="hx-c-div" aria-hidden="true" />
        <textarea
          ref={textareaRef}
          className="hx-input"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message HYDRO…"
          rows={1}
          aria-label="Message HYDRO"
          spellCheck
        />
        {attachName && (
          <span className="badge" data-tone="info" title={attachName}>
            {attachName.slice(0, 16)}
            <button
              type="button"
              onClick={() => setAttachName(null)}
              aria-label="Remove attachment"
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                display: "flex",
              }}
            >
              <IconClose size={11} />
            </button>
          </span>
        )}
        <select
          className="hx-model"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as Mode)}
          aria-label="Intelligence mode"
          title={MODES.find((m) => m.id === mode)?.hint}
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} mode
            </option>
          ))}
        </select>
        {busy ? (
          <button type="button" className="hx-send" onClick={onStop} aria-label="Stop generating">
            <IconStop size={17} />
          </button>
        ) : (
          <button
            type="button"
            className="hx-send"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="Send message"
          >
            <IconSend size={18} />
          </button>
        )}
      </div>

      <div className="hx-composer-hint">
        <select
          className="hx-inline-select"
          value={replyLanguage}
          onChange={(event) => onLanguageChange(event.target.value as ReplyLanguage)}
          aria-label="Reply language"
        >
          {LANGUAGES.map((language) => (
            <option key={language.id} value={language.id}>
              {language.label}
            </option>
          ))}
        </select>
        {ttsEnabled && (
          <button type="button" onClick={() => onAutoSpeakChange(!autoSpeak)}>
            {autoSpeak ? "Spoken answers on" : "Spoken answers off"}
          </button>
        )}
        {!sttEnabled && <span>Speech-to-text is not configured.</span>}
        <span>HYDRO coordinates several models — verify anything important.</span>
      </div>

      {voiceError && (
        <div className="hx-error" role="status">
          {voiceError}
        </div>
      )}
    </div>
  );
});

export default Composer;
