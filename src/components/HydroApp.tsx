"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Composer, { type ComposerHandle } from "@/components/Composer";
import Genesis from "@/components/Genesis";
import ArtStage from "@/components/ArtStage";
import type { ConversationPhase, VisionPhase } from "@/lib/motion/hydroMotion";
import Inspector from "@/components/Inspector";
import Panels from "@/components/Panels";
import VisionDock from "@/components/VisionDock";
import WorkspacePanel from "@/components/WorkspacePanel";
import NotesDrawer from "@/components/NotesDrawer";
import { Markdown } from "@/lib/markdown";
import { useAffect } from "@/lib/useAffect";
import { useInteraction } from "@/lib/useInteraction";
import { usePulse } from "@/lib/usePulse";
import { useVision } from "@/lib/useVision";
import { useVoice } from "@/lib/useVoice";
import { READ_TEXT_QUESTION } from "@/lib/vision/sight";
import { selectionContext, selectionLabel, type SelectionRect } from "@/lib/vision/selection";
import {
  isReplyLanguage,
  noteTitle,
  parseForgetRequest,
  parseRememberRequest,
  parseSaveRequest,
  type ReplyLanguage,
  type SaveIntent,
} from "@/lib/assistant/intents";
import { wantsVisualAnswer } from "@/lib/vision/intent";
import { useLiveSession } from "@/lib/useLiveSession";
import {
  COMMAND_LABELS,
  LIVE_MODES,
  PROACTIVE_TURN_INTERVAL_MS,
  PRESENT_QUESTION,
  decideGesture,
  detectSpokenControl,
  gesturePrompt,
  modeSpec,
  presencePrompt,
  type LiveCommand,
  type LiveMode,
} from "@/lib/interaction/live";
import {
  IconChat,
  IconCopy,
  IconFolder,
  IconInsight,
  IconMenu,
  IconMic,
  IconNote,
  IconPlus,
  IconSettings,
  IconVolume,
  IconVolumeOff,
} from "@/components/Icons";
import type { MetaEvent, Mode, StreamEvent, TraceEvent } from "@/core/types";

export type MsgChannel = "typed" | "spoken" | "gesture" | "presence" | "vision" | "control";

const CHANNEL_LABEL: Record<MsgChannel, string> = {
  typed: "",
  spoken: "spoken",
  gesture: "gesture",
  presence: "camera noticed you",
  vision: "camera",
  control: "interaction",
};

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace: TraceEvent[];
  meta?: MetaEvent | null;
  error?: string | null;
  pending?: boolean;
  /** where this turn came from, so a gesture is never shown as typing */
  via?: MsgChannel;
}

const MODE_ORDER: Mode[] = ["flash", "hybrid", "deep", "council"];

const SUGGESTIONS = [
  "Explain recursion with a small Python example",
  "Compare Postgres and SQLite for a side project",
  "Write a Telugu-English explanation of HTTP caching",
  "What changed in AI models this year?",
];

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function HydroApp() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [mode, setMode] = useState<Mode>("hybrid");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [listening, setListening] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [genesis, setGenesis] = useState(false);
  const [flash, setFlash] = useState<"SUCCESS" | "ERROR" | "INTERRUPTED" | "RECOVERING" | null>(
    null,
  );
  const [observeBusy, setObserveBusy] = useState(false);
  const [attentive, setAttentive] = useState(false);
  const [stageExpanded, setStageExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [captureState, setCaptureState] = useState<
    "idle" | "requesting" | "listening" | "transcribing"
  >("idle");
  const composerRef = useRef<ComposerHandle | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  // Live interaction mode governs only the automatic paths (speech, gesture
  // commands, proactive turns). The camera button still works in every mode
  // except Privacy, which is the point of Privacy.
  const [liveMode, setLiveMode] = useState<LiveMode>("gesture");
  const [liveTranscript, setLiveTranscript] = useState("");
  // A spoken "stop listening" must not be undone by the next render.
  const [micBlocked, setMicBlocked] = useState(false);
  const [liveCommand, setLiveCommand] = useState<{
    label: string;
    gesture: string;
    confidence: number;
    at: number;
  } | null>(null);
  // Selected region of the camera frame, framed by the user on the preview.
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  // OCR output of the last reading pass, and any measured caveat about it.
  const [ocrText, setOcrText] = useState("");
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesFocus, setNotesFocus] = useState<string | null>(null);
  const [notesRefresh, setNotesRefresh] = useState(0);
  const [project, setProject] = useState("general");
  const [replyLang, setReplyLang] = useState<ReplyLanguage>("auto");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [pendingPlan, setPendingPlan] = useState<{
    planId: string;
    plan: {
      intent: string;
      summary: string;
      steps: Array<{ tool: string; note: string }>;
      requiresApproval: boolean;
      risk: string;
    };
  } | null>(null);

  // read inside callbacks so a proactive observation never fires mid-reply
  const busyRef = useRef(false);
  busyRef.current = busy;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attentiveTimer = useRef<number | null>(null);
  // one-shot activity ping consumed by the hologram's render loop
  const activityRef = useRef(0);
  const lastGestureId = useRef(0);
  const lastCommandAt = useRef<Record<string, number>>({});
  const wasPresent = useRef(false);
  const lastGreetAt = useRef(0);
  // send is declared after the gesture executor; this ref bridges the two
  const sendRef = useRef<(text: string, via?: MsgChannel) => Promise<void>>(async () => {});
  // the gesture effect is declared before the executor; this ref bridges them
  const runDeviceRef = useRef<(text: string) => Promise<boolean>>(async () => false);
  const stopRef = useRef<() => void>(() => {});
  const observeRef = useRef<(question?: string) => Promise<void>>(async () => {});
  const voice = useVoice();
  const pulse = usePulse();
  const vision = useVision({
    isBusy: () => busyRef.current,
    // A proactive comment is a finished observation the user asked HYDRO to
    // share; it is appended as HYDRO's own message, clearly marked as camera.
    onObservation: (note) => {
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "assistant", content: `Camera observation — ${note.text}`, trace: [] },
      ]);
    },
  });
  const affect = useAffect({ vision });
  const liveSpec = modeSpec(liveMode);
  // Automatic speech. With the microphone in a live mode, HYDRO records only
  // voiced segments, transcribes them and submits the ones the policy accepts;
  // its own voice is never listened to.
  const live = useLiveSession({
    mode: liveMode,
    enabled: liveSpec.mic && !micBlocked,
    autoSubmit: liveSpec.autoSubmit,
    speaking: voice.speaking,
    echoText: () => spokenRef.current,
    busy: () => busyRef.current,
    onTranscript: setLiveTranscript,
    onSubmit: (text) => void sendRef.current(text, "spoken"),
  });
  // what HYDRO is currently saying (for lip sync), set right before playback
  const spokenRef = useRef("");
  // battery is the one environment fact the server cannot measure, so the page
  // reports it; null means "unknown" and is omitted from the request
  const batteryRef = useRef<{ level: number; charging: boolean } | null>(null);
  const interaction = useInteraction({
    audio: () => voice.amplitude.current,
    visible: () => {
      const s = vision.signalsRef.current;
      return { smile: s.mirrorSmile, brow: s.mirrorBrow, squint: s.mirrorSquint, jaw: s.mouth };
    },
  });
  const caps = pulse.capabilities;

  // Session preferences. Language, autospeak and project persist; the camera
  // selection and OCR text never do.
  useEffect(() => {
    try {
      const lang = localStorage.getItem("hydro.reply-language.v1");
      if (isReplyLanguage(lang)) setReplyLang(lang);
      const savedProject = localStorage.getItem("hydro.project.v1");
      if (savedProject && /^[a-zA-Z0-9 -]{1,40}$/.test(savedProject)) setProject(savedProject);
      const speak = localStorage.getItem("hydro.autospeak.v1");
      if (speak === "0") setAutoSpeak(false);
    } catch {
      /* storage blocked — defaults apply */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("hydro.reply-language.v1", replyLang);
      localStorage.setItem("hydro.project.v1", project);
      localStorage.setItem("hydro.autospeak.v1", autoSpeak ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [autoSpeak, project, replyLang]);

  // ── battery (browser-only fact) ──────────────────────────────────────────
  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener?: (type: string, fn: () => void) => void;
      }>;
    };
    if (!nav.getBattery) return;
    let alive = true;
    void nav
      .getBattery()
      .then((battery) => {
        const read = () => {
          if (alive) batteryRef.current = { level: battery.level, charging: battery.charging };
        };
        read();
        battery.addEventListener?.("levelchange", read);
        battery.addEventListener?.("chargingchange", read);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // ── first launch ─────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      if (!localStorage.getItem("hydro.genesis.v1")) setGenesis(true);
    } catch {
      /* storage blocked — skip the cinematic */
    }
  }, []);

  const completeGenesis = useCallback(() => {
    try {
      localStorage.setItem("hydro.genesis.v1", "done");
    } catch {
      /* ignore */
    }
    setGenesis(false);
  }, []);

  // ── hologram state ───────────────────────────────────────────────────────
  // One source of truth: the interaction controller. The core used to be
  // derived a second time here, which let the readout say "Thinking" while the
  // expression had already moved on. A tracked person still nudges the core
  // through the presence event the controller receives.
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(
      () => setFlash(null),
      flash === "ERROR" ? 2400 : flash === "INTERRUPTED" ? 1200 : flash === "RECOVERING" ? 2200 : 1500,
    );
    return () => clearTimeout(t);
  }, [flash]);

  // ── interaction controller wiring ────────────────────────────────────────
  // Everything the face reacts to arrives as an event: camera, speech, the
  // pipeline's phase, errors and gestures. The controller owns the reaction;
  // React only pushes facts.
  useEffect(() => {
    interaction.push({ kind: "camera", live: vision.live });
  }, [interaction, vision.live]);

  useEffect(() => {
    // An acknowledged gesture keeps HYDRO attentive even without a camera.
    interaction.push({ kind: "presence", present: vision.present || attentive });
  }, [attentive, interaction, vision.present]);

  useEffect(() => {
    interaction.push({ kind: listening ? "listen-start" : "listen-end" });
  }, [interaction, listening]);

  useEffect(() => {
    // Lip sync follows the text that was actually synthesised — normalised, in
    // the spoken language — rather than the Markdown answer.
    if (voice.speaking) {
      interaction.push({
        kind: "speech-start",
        text: voice.stats.planText || spokenRef.current,
        rate: voice.stats.language ? voice.settings.speed : 1,
        durationMs: voice.stats.audioMs ?? undefined,
      });
    } else {
      interaction.push({ kind: "speech-end" });
    }
  }, [interaction, voice.settings.speed, voice.speaking, voice.stats.audioMs, voice.stats.language, voice.stats.planText]);

  useEffect(() => {
    if (busy && phase) interaction.push({ kind: "phase", phase });
  }, [busy, interaction, phase]);

  const acknowledge = useCallback((ms = 4200) => {
    setAttentive(true);
    if (attentiveTimer.current) window.clearTimeout(attentiveTimer.current);
    attentiveTimer.current = window.setTimeout(() => setAttentive(false), ms);
  }, []);

  /** A command receipt: interface feedback, never presented as a reply. */
  const pushNotice = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: makeId(), role: "assistant", content: text, trace: [], via: "control" },
    ]);
  }, []);

  /** Switch interaction mode, applying the mode's own restrictions. */
  const applyMode = useCallback(
    (next: LiveMode, announce = false) => {
      const spec = modeSpec(next);
      setLiveMode(next);
      setMicBlocked(false);
      // Privacy and Manual do not get to leave the camera running.
      if (!spec.camera && vision.live) vision.disable();
      try {
        // A mode that opens the microphone is never restored silently.
        localStorage.setItem("hydro.live-mode.v1", spec.mic ? "gesture" : next);
      } catch {
        /* storage blocked */
      }
      if (announce) pushNotice(`${spec.label} mode on. ${spec.hint}`);
    },
    [pushNotice, vision],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem("hydro.live-mode.v1");
      if (saved && LIVE_MODES.some((m) => m.id === saved && !m.mic) && saved !== liveMode) {
        setLiveMode(saved as LiveMode);
      }
    } catch {
      /* ignore */
    }
    // Read once on mount; the user's later choice wins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Approve or reject the plan that is currently waiting in the workspace. */
  const decidePendingPlan = useCallback(
    async (approve: boolean) => {
      const current = pendingPlan;
      if (!current) return;
      if (approve && current.plan.risk === "high") {
        pushNotice("That plan is high risk, so a gesture cannot approve it. Use the workspace panel.");
        return;
      }
      setLiveCommand({
        label: approve ? "Approve pending action" : "Reject pending action",
        gesture: "thumbs",
        confidence: 1,
        at: Date.now(),
      });
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ planId: current.planId, approve }),
        });
        const data = (await res.json()) as {
          error?: string;
          cancelled?: boolean;
          record?: { ok: boolean; results: Array<{ tool: string; detail: string }> };
        };
        setPendingPlan(null);
        if (!res.ok) {
          pushNotice(data.error ?? "That plan could not be handled.");
          return;
        }
        if (!approve) {
          pushNotice("Rejected — nothing was changed.");
          return;
        }
        const body = (data.record?.results ?? [])
          .map((r) => `- \`${r.tool}\` ${r.detail}`)
          .join("\n");
        pushNotice(`Approved by gesture and run on this machine.\n\n${body}`);
        setFlash(data.record?.ok ? "SUCCESS" : "ERROR");
      } catch {
        pushNotice("The approval request could not be delivered.");
      }
    },
    [pendingPlan, pushNotice],
  );

  useEffect(
    () => () => {
      if (attentiveTimer.current) window.clearTimeout(attentiveTimer.current);
    },
    [],
  );

  // ── gesture → command ────────────────────────────────────────────────────
  // One recognised gesture is resolved by the tested policy in
  // interaction/live.ts: mode permission, confidence, cooldown and whether
  // there is anything legitimate to act on. A gesture that fails any check
  // does nothing and says why in the dashboard.
  const executeCommand = useCallback(
    (command: LiveCommand, gestureName: string, confidence: number) => {
      lastCommandAt.current[gestureName] = Date.now();
      switch (command) {
        case "greet":
          acknowledge(3200);
          setFlash("SUCCESS");
          if (modeSpec(liveMode).autoAct) {
            void sendRef.current(gesturePrompt("wave"), "gesture");
          }
          break;
        case "attention":
          acknowledge(5200);
          break;
        case "pause-speech":
          // A palm is a stop request: it changes nothing but playback.
          voice.stop();
          break;
        case "approve":
          void decidePendingPlan(true);
          break;
        case "reject":
          void decidePendingPlan(false);
          break;
        case "previous":
          setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]);
          break;
        case "next":
          setMode(
            (m) =>
              MODE_ORDER[
                (MODE_ORDER.indexOf(m) - 1 + MODE_ORDER.length) % MODE_ORDER.length
              ],
          );
          break;
        case "scroll-up":
          scrollerRef.current?.scrollBy({ top: -Math.round(window.innerHeight * 0.35), behavior: "smooth" });
          break;
        case "scroll-down":
          scrollerRef.current?.scrollBy({ top: Math.round(window.innerHeight * 0.35), behavior: "smooth" });
          break;
        case "analyze-object":
          acknowledge(4000);
          if (modeSpec(liveMode).looks && vision.live) void observeRef.current(PRESENT_QUESTION);
          break;
        case "acknowledge":
          setFlash("SUCCESS");
          interaction.push({ kind: "gesture", name: "acknowledge" });
          break;
        case "disagree":
          if (pendingPlan) void decidePendingPlan(false);
          break;
        case "stop": {
          stopRef.current();
          applyMode("manual", true);
          break;
        }
        default:
          break;
      }
      setLiveCommand({ label: COMMAND_LABELS[command], gesture: gestureName, confidence, at: Date.now() });
    },
    [acknowledge, applyMode, decidePendingPlan, interaction, liveMode, pendingPlan, voice],
  );

  const executeCommandRef = useRef(executeCommand);
  executeCommandRef.current = executeCommand;

  useEffect(() => {
    const gesture = vision.events[0];
    if (!gesture) return;
    // Taught poses keep their own command text.
    if (gesture.id === lastGestureId.current) return;
    lastGestureId.current = gesture.id;
    interaction.push({ kind: "gesture", name: gesture.name });

    if (gesture.name === "custom") {
      if (gesture.custom && modeSpec(liveMode).gestures) {
        void runDeviceRef.current(gesture.custom.command);
        setLiveCommand({ label: "Taught gesture", gesture: "custom", confidence: gesture.confidence, at: Date.now() });
      }
      return;
    }

    const decision = decideGesture({
      gesture: gesture.name,
      confidence: gesture.confidence,
      mode: liveMode,
      speaking: voice.speaking,
      pendingApproval: Boolean(pendingPlan),
      pendingRisk: pendingPlan?.plan.risk ?? null,
      busy,
      now: Date.now(),
      lastAt: lastCommandAt.current[gesture.name] ?? null,
    });

    if (!decision.run) {
      if (decision.reason === "needs-explicit-approval") {
        pushNotice("That plan is high risk — approve it in the workspace panel instead.");
      }
      return;
    }
    executeCommandRef.current(decision.command, gesture.name, gesture.confidence);
  }, [busy, interaction, liveMode, pendingPlan, pushNotice, vision.events, voice.speaking]);

  // ── scrolling ────────────────────────────────────────────────────────────
  const pinned = useRef(true);
  useEffect(() => {
    const el = scrollerRef.current;
    // On the empty state there is nothing to follow: scrolling here pushed the
    // hero heading out of the short scroller on laptop-sized windows.
    if (!el || !pinned.current || !messages.length) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  // ── device execution ─────────────────────────────────────────────────────
  // Imperative instructions are offered to the local task engine first. If it
  // has a real tool for them they run on this machine and no model is called;
  // otherwise the message continues as ordinary conversation.
  const runDevice = useCallback(async (text: string): Promise<boolean> => {
    if (!text.trim()) return false;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: text }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        kind?: string;
        planId?: string;
        plan?: {
          intent: string;
          summary: string;
          steps: Array<{ tool: string; note: string }>;
          requiresApproval: boolean;
          risk: string;
        };
        record?: {
          ok: boolean;
          summary: string;
          results: Array<{ tool: string; ok: boolean; detail: string }>;
        };
      };

      if ((data.kind === "executed" || data.kind === "workflow") && data.record) {
        const body = data.record.results
          .map((r) => `- \`${r.tool}\` ${r.detail}`)
          .join("\n");
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "user", content: text, trace: [] },
          {
            id: makeId(),
            role: "assistant",
            content: `${data.record!.ok ? "Done" : "Stopped and reported"} — ran on this machine.\n\n${body}`,
            trace: [],
          },
        ]);
        setFlash(data.record.ok ? "SUCCESS" : "ERROR");
        return true;
      }

      if (data.kind === "approval_required" && data.planId && data.plan) {
        setPendingPlan({ planId: data.planId, plan: data.plan });
        setWorkspaceOpen(true);
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "user", content: text, trace: [] },
          {
            id: makeId(),
            role: "assistant",
            content:
              "That needs your approval first, so nothing was changed. The plan is open in the workspace panel — review the steps, then Execute or Cancel.",
            trace: [],
          },
        ]);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  runDeviceRef.current = runDevice;

  /**
   * Save a note. The server reads the file back, so the notice only says
   * "saved" when the bytes are actually on disk, and the drawer opens that
   * exact path so the result can be reopened immediately.
   */
  const saveNote = useCallback(
    async (intent: SaveIntent | null, explicit?: string) => {
      const answer =
        explicit ??
        [...messages]
          .reverse()
          .find((m) => m.role === "assistant" && m.content.trim() && m.via !== "control")
          ?.content;
      if (!answer?.trim()) {
        pushNotice("There is nothing to save yet — ask me something first.");
        return;
      }
      const title = noteTitle(
        intent?.title ?? "",
        noteTitle(answer, `HYDRO note ${new Date().toLocaleDateString()}`),
      );
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project, title, content: answer, source: "conversation" }),
        });
        const data = (await res.json()) as {
          note?: { path: string; title: string; project: string };
          error?: string;
        };
        if (!res.ok || !data.note) throw new Error(data.error ?? `Save failed (${res.status})`);
        setNotesFocus(data.note.path);
        setNotesRefresh((n) => n + 1);
        setNotesOpen(true);
        pushNotice(
          `Saved “${data.note.title}” to project “${data.note.project}” → ${data.note.path}. The file was read back from disk to verify it.`,
        );
        interaction.push({ kind: "activity", activity: "remembering", on: true, ms: 2600 });
      } catch (err) {
        pushNotice(err instanceof Error ? err.message : "Could not save that note.");
      }
    },
    [interaction, messages, project, pushNotice],
  );

  const rememberFact = useCallback(
    async (fact: string) => {
      try {
        const res = await fetch("/api/memory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: fact, project }),
        });
        const data = (await res.json()) as { record?: { content: string }; error?: string };
        if (!res.ok || !data.record) throw new Error(data.error ?? "Memory did not accept that record.");
        pushNotice(
          `Remembered for project “${project}”: ${data.record.content}. Recall follows the memory switch in the menu.`,
        );
      } catch (err) {
        pushNotice(err instanceof Error ? err.message : "Could not save that memory.");
      }
    },
    [project, pushNotice],
  );

  const forgetFact = useCallback(
    async (query: string) => {
      try {
        const res = await fetch(`/api/memory?q=${encodeURIComponent(query)}`, { method: "DELETE" });
        const data = (await res.json()) as { removed?: number; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Memory refused the delete.");
        const deictic = /^(this|that|it|the last one|the latest)$/i.test(query);
        const label = query && !deictic ? ` “${query}”` : "";
        pushNotice(
          data.removed
            ? `Forgotten${label || ": the most recent memory"}.`
            : `No saved memory matched${label || " anything"}.`,
        );
      } catch (err) {
        pushNotice(err instanceof Error ? err.message : "Could not forget that.");
      }
    },
    [pushNotice],
  );

  /** Commands handled locally and verifiably, never sent to a model. */
  const handleLocalIntent = useCallback(
    async (text: string): Promise<boolean> => {
      const forget = parseForgetRequest(text);
      if (forget) {
        await forgetFact(forget.query);
        return true;
      }
      const remember = parseRememberRequest(text);
      if (remember) {
        await rememberFact(remember);
        return true;
      }
      const save = parseSaveRequest(text);
      if (save) {
        await saveNote(save);
        return true;
      }
      return false;
    },
    [forgetFact, rememberFact, saveNote],
  );

  // ── send ─────────────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string, via: MsgChannel = "typed") => {
      if (busy || !text.trim()) return;
      // A new turn interrupts the previous answer. Without this the old audio
      // keeps playing under the new request, which is the "overlapping voices"
      // failure mode.
      if (voice.settings.interruptions) voice.stop();

      // A spoken mode change is handled as a command, not sent to a model.
      if (via === "spoken") {
        const control = detectSpokenControl(text);
        if (control) {
          if (control.kind === "mode") {
            applyMode(control.mode, true);
          } else if (control.kind === "stop-microphone") {
            live.stop();
            setMicBlocked(true);
            pushNotice("Microphone off. Gestures and typing still work.");
          } else if (control.kind === "stop-camera") {
            vision.disable();
            pushNotice("Camera stopped.");
          } else {
            stopRef.current();
            applyMode("privacy", true);
          }
          return;
        }
      }

      // Saving, remembering and forgetting are file operations with a real
      // read-back; they must not become a model's opinion about saving.
      if (await handleLocalIntent(text)) return;

      if (await runDevice(text)) return;
      interaction.push({ kind: "user-message", text });
      affect.observeInput(text);
      const assistantId = makeId();
      const history = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ];

      pinned.current = true;
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "user", content: text, trace: [], via },
        { id: assistantId, role: "assistant", content: "", trace: [], pending: true },
      ]);
      setBusy(true);
      setPhase("classify");

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const patch = (fn: (m: Msg) => Msg) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      try {
        // A recent camera observation travels with the question, so "what am I
        // holding?" works from chat. Stale context is deliberately dropped.
        const scene = vision.sceneRef.current;
        const visualContext =
          scene && Date.now() - scene.at < 120_000 ? scene.text : undefined;

        // The camera's measured state always travels, so HYDRO knows whether it
        // has eyes right now. A frame travels only when the question is about
        // what is visible or a region is selected: one capture, one paid look.
        const sample = vision.getSample();
        const wantsLook = wantsVisualAnswer(text) || Boolean(selection);
        const frame =
          (vision.live || vision.frozen) && wantsLook
            ? await vision.captureSelected(selection)
            : null;
        const regionContext = selection ? selectionContext(selection) : "";
        const camera = {
          active: vision.live,
          presence: sample.face.present,
          faces: sample.faces,
          hands: sample.hands.count,
          gesture: sample.hands.gesture ?? undefined,
          gazeX: sample.face.gazeX,
          gazeY: sample.face.gazeY,
          light: vision.quality?.level,
          frameAgeMs: 0,
        };

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: history,
            mode,
            visualContext: [visualContext, regionContext].filter(Boolean).join("\n\n") || undefined,
            language: replyLang,
            project,
            affect: affect.directive(),
            device: {
              online: navigator.onLine,
              battery: batteryRef.current ?? undefined,
            },
            image: frame?.dataUrl,
            camera,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          console.error("[chat] request failed", res.status);
          throw new Error(
            "Connection problem — I couldn't reach the intelligence service. Please try again.",
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            const line = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;

            let event: StreamEvent;
            try {
              event = JSON.parse(line.slice(5).trim()) as StreamEvent;
            } catch {
              continue;
            }

            if (event.kind === "token") {
              patch((m) => ({ ...m, content: m.content + event.text }));
            } else if (event.kind === "trace") {
              setPhase(event.phase);
              // Memory retrieval is a real pipeline step; show it on the core.
              if (/^memory$/i.test(event.step)) {
                interaction.push({ kind: "activity", activity: "remembering", on: true, ms: 4000 });
              }
              patch((m) => ({ ...m, trace: [...m.trace, event] }));
            } else if (event.kind === "meta") {
              patch((m) => ({
                ...m,
                meta: event,
                content: m.content || event.answer,
                pending: false,
              }));
              setSelected(assistantId);
              // Speak the complete answer unless the user turned that off. The
              // microphone is released before this, so HYDRO never hears itself.
              if (autoSpeak && caps.tts && voice.settings.enabled && event.answer.trim()) {
                spokenRef.current = event.answer;
                void voice.speak(event.answer, interaction.prosody());
              }
              interaction.push({ kind: "reply-complete", degraded: event.degraded });
              // A degraded run still produced an answer, so it settles into a
              // calm recovery pulse rather than an error flash.
              setFlash(event.degraded ? "RECOVERING" : "SUCCESS");
            } else if (event.kind === "error") {
              patch((m) => ({ ...m, error: event.message, pending: false }));
              interaction.push({ kind: "error", message: event.message });
              setFlash("ERROR");
            }
          }
        }
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        patch((m) => ({
          ...m,
          pending: false,
          error: aborted
            ? m.content
              ? null
              : "Stopped before any output."
            : err instanceof Error && err.name === "TypeError"
              ? "Connection problem — I couldn't reach the intelligence service. Please try again."
              : err instanceof Error
                ? err.message
                : "Request failed — please try again.",
        }));
        if (!aborted) {
          interaction.push({ kind: "error" });
          setFlash("ERROR");
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        setPhase("");
        patch((m) => ({ ...m, pending: false }));
      }
    },
    [
      affect,
      applyMode,
      autoSpeak,
      busy,
      caps.tts,
      handleLocalIntent,
      interaction,
      live,
      messages,
      mode,
      project,
      pushNotice,
      replyLang,
      runDevice,
      selection,
      vision,
      voice,
    ],
  );

  // ── emergency stop ───────────────────────────────────────────────────────
  // Cancels the model stream, playback and any running device plan. The device
  // engine checks the cancellation between steps, so it reports exactly what
  // ran and performs nothing further.
  const stop = () => {
    const wasBusy = busy;
    abortRef.current?.abort();
    voice.stop();
    // The microphone stops too, and does not restart itself behind the user.
    live.stop();
    setMicBlocked(true);
    interaction.push({ kind: "interrupt" });
    void fetch("/api/tasks", { method: "DELETE" }).catch(() => undefined);
    if (wasBusy) setFlash("INTERRUPTED");
  };

  stopRef.current = stop;

  // ── one authorised visual question ───────────────────────────────────────
  // The frame is captured in the browser, sent once, and never stored.
  const observe = useCallback(async (asked?: string) => {
    if (observeBusy) return;
    const frame = await vision.captureSelected(selection);
    if (!frame) {
      setFlash("ERROR");
      return;
    }
    const question =
      asked?.trim() ||
      draft.trim() ||
      "What can you see in this frame? Describe only what is clearly visible.";
    const reading = asked === READ_TEXT_QUESTION;
    const userId = makeId();
    const assistantId = makeId();

    setObserveBusy(true);
    interaction.push({ kind: "observe-start" });
    vision.markScan(true);
    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: "user",
        content: asked ? "Camera frame — read the visible text" : `Camera frame — ${question}`,
        trace: [],
      },
      { id: assistantId, role: "assistant", content: "", trace: [], pending: true },
    ]);
    // A reading request must not wipe a draft the user is writing.
    if (!asked) setDraft("");

    try {
      const res = await fetch("/api/vision/observe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: frame.dataUrl, question }),
      });
      const data = (await res.json()) as {
        answer?: string;
        model?: string;
        latencyMs?: number;
        error?: string;
      };
      if (!res.ok || !data.answer) {
        throw new Error(data.error ?? `Vision request failed (${res.status})`);
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: data.answer as string,
                pending: false,
                error: null,
                meta: null,
              }
            : m,
        ),
      );
      // The answer becomes temporary visual context, so a follow-up ("explain
      // the second step") refers to the same frame during this session.
      vision.sceneRef.current = {
        text: data.answer.slice(0, 1200),
        at: Date.now(),
        model: data.model ?? null,
      };
      if (reading) {
        setOcrText(data.answer);
        setOcrNote(
          selection
            ? `read from the selected region · ${data.model ?? "vision model"}`
            : `read from the current frame · ${data.model ?? "vision model"}`,
        );
      }
      vision.noteCall({ model: data.model ?? null, latencyMs: data.latencyMs ?? null, frames: 1, error: null });
      setFlash("SUCCESS");
    } catch (err) {
      vision.noteCall({
        model: null,
        latencyMs: null,
        frames: null,
        error: err instanceof Error ? err.message : "Vision request failed.",
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                pending: false,
                error: err instanceof Error ? err.message : "Vision request failed.",
              }
            : m,
        ),
      );
      setFlash("ERROR");
    } finally {
      setObserveBusy(false);
      interaction.push({ kind: "observe-end" });
      vision.markScan(false);
    }
  }, [draft, interaction, observeBusy, selection, vision]);

  sendRef.current = send;
  observeRef.current = observe;

  /** Translate the last reading into English using the same frozen frame. */
  const translateOcr = useCallback(async () => {
    if (!ocrText || observeBusy) return;
    const frame = await vision.captureSelected(selection);
    if (!frame) {
      pushNotice("Freeze the frame first so the translation reads a stable image.");
      return;
    }
    setObserveBusy(true);
    try {
      const res = await fetch("/api/vision/observe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: frame.dataUrl,
          question:
            "Translate the text visible in this image into English. Preserve numbers, labels and technical terms. Mark any word you cannot read clearly as [unclear]. Do not add anything that is not written there.",
        }),
      });
      const data = (await res.json()) as { answer?: string; error?: string; model?: string };
      if (!res.ok || !data.answer) throw new Error(data.error ?? "Translation failed.");
      setOcrText(data.answer);
      setOcrNote(`translated into English · ${data.model ?? "vision model"}`);
    } catch (err) {
      pushNotice(err instanceof Error ? err.message : "Translation failed.");
    } finally {
      setObserveBusy(false);
    }
  }, [observeBusy, ocrText, pushNotice, selection, vision]);

  // A selection belongs to the camera session. Closing the camera releases it.
  useEffect(() => {
    if (!vision.live && !vision.frozen) {
      setSelection(null);
      setSelectMode(false);
    }
  }, [vision.frozen, vision.live]);

  // A face genuinely appearing in a live session is the only event that may
  // start a turn by itself. One greeting per interval, never over a reply and
  // never twice for the same appearance.
  useEffect(() => {
    const present = vision.live && vision.present;
    if (
      present &&
      !wasPresent.current &&
      liveSpec.proactive &&
      !busy &&
      Date.now() - lastGreetAt.current > PROACTIVE_TURN_INTERVAL_MS
    ) {
      lastGreetAt.current = Date.now();
      void sendRef.current(presencePrompt(), "presence");
    }
    wasPresent.current = present;
  }, [busy, liveSpec.proactive, vision.live, vision.present]);

  const selectedMsg = messages.find((m) => m.id === selected) ?? null;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const inspectorMeta = selectedMsg?.meta ?? lastAssistant?.meta ?? null;
  const inspectorTrace = selectedMsg?.trace ?? lastAssistant?.trace ?? [];

  // ── phases, derived from real events only ────────────────────────────────
  // The stage is told what is actually happening: a permission request, real
  // microphone capture, a streaming reply, real playback. Nothing is inferred
  // from a timer.
  const conversation = messages.length > 0;
  const motionPhase: ConversationPhase =
    captureState === "listening" || live.listening
      ? "listening"
      : captureState === "requesting"
        ? "requesting-mic"
        : busy
          ? "thinking"
          : voice.speaking
            ? "speaking"
            : voice.error
              ? "error"
              : "standby";

  const PHASE_LABEL: Record<ConversationPhase, string> = {
    standby: "Standby",
    "requesting-mic": "Requesting microphone",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    error: "Needs attention",
  };

  const visionPhase: VisionPhase =
    vision.status === "live"
      ? "live"
      : vision.status === "requesting"
        ? "requesting"
        : vision.status === "loading"
          ? "starting"
          : vision.status === "idle"
            ? "off"
            : "error";

  const VISION_LABEL: Record<VisionPhase, string> = {
    off: "off",
    requesting: "requesting permission",
    starting: "starting",
    live: "live",
    error: vision.error ? "unavailable" : "closed",
  };

  const talkLabel =
    captureState === "requesting"
      ? "Opening mic…"
      : captureState === "listening"
        ? "Listening…"
        : captureState === "transcribing"
          ? "Transcribing…"
          : "Tap to speak";

  const visionLabel =
    vision.status === "live"
      ? "Stop vision"
      : vision.status === "requesting"
        ? "Requesting camera…"
        : vision.busy
          ? "Starting camera…"
          : "Start vision";

  const newSession = () => {
    stop();
    composerRef.current?.cancel();
    setMessages([]);
    setSelected(null);
    setDraft("");
    setOcrText("");
    setOcrNote(null);
    setSelection(null);
    setSelectMode(false);
    setStageExpanded(false);
    setNotesFocus(null);
    setMessages([]);
  };

  // The first reply collapses the artwork; keep the newest message in view.
  useEffect(() => {
    if (!conversation) return;
    const el = scrollerRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(id);
  }, [conversation, messages.length]);

  // Escape closes the mobile navigation drawer without touching the draft.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const statusAnnouncement =
    motionPhase === "listening"
      ? "Listening. Speak, then tap Done."
      : motionPhase === "requesting-mic"
        ? "Waiting for microphone permission."
        : motionPhase === "thinking"
          ? "HYDRO is thinking."
          : motionPhase === "speaking"
            ? "HYDRO is speaking."
            : motionPhase === "error"
              ? "HYDRO needs attention."
              : "HYDRO is on standby.";

  const openInspector = (id: string) => {
    setSelected(id);
    setInspectorOpen(true);
  };


  return (
    <>
      {genesis && (
        <Genesis
          onComplete={completeGenesis}
          onIntroVoice={() => {
            if (!caps.tts) return;
            spokenRef.current = "Hello, world. I am HYDRO. My journey begins here.";
            void voice.speak(spokenRef.current, interaction.prosody());
          }}
        />
      )}

      <div
        className="app"
        data-mode={conversation ? "conversation" : "welcome"}
        data-expanded={stageExpanded ? "true" : "false"}
        data-calm={affect.calmActive ? "true" : "false"}
      >
        <p className="sr-only" aria-live="polite">
          {statusAnnouncement}
        </p>

        <header className="hx-top">
          <button
            type="button"
            className="hx-iconbtn hx-menu-toggle"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={drawerOpen}
          >
            <IconMenu size={17} />
          </button>
          <span className="hx-mark" aria-hidden="true">
            H
          </span>
          <span className="hx-word">HYDRO</span>
          <span className="hx-top-div" aria-hidden="true" />
          <span className="hx-top-title">{conversation ? "Conversation" : "Workspace"}</span>
          <div className="hx-top-actions">
            <button
              type="button"
              className="hx-iconbtn"
              onClick={() => {
                setNotesFocus(null);
                setNotesOpen(true);
              }}
              aria-label="Project notes"
              title="Project notes"
            >
              <IconNote size={16} />
            </button>
            <button
              type="button"
              className="hx-iconbtn"
              onClick={() => setWorkspaceOpen(true)}
              aria-label="Open workspace"
              title="Workspace, files and learned workflows"
            >
              <IconFolder size={16} />
            </button>
            <button type="button" className="hx-new" onClick={newSession}>
              <IconPlus size={15} />
              New session
            </button>
          </div>
        </header>

        <div className="hx-layout">
          <nav className="hx-rail" data-open={drawerOpen ? "true" : "false"} aria-label="Workspace">
            <button
              type="button"
              className="hx-rail-btn"
              data-active="true"
              aria-current="page"
              onClick={() => {
                setDrawerOpen(false);
                composerRef.current?.start();
              }}
              aria-label="Chat — start a voice turn"
              title="Chat"
            >
              <IconChat size={20} />
            </button>
            <button
              type="button"
              className="hx-rail-btn"
              onClick={() => {
                setDrawerOpen(false);
                setWorkspaceOpen(true);
              }}
              aria-label="Files and workspace"
              title="Files"
            >
              <IconFolder size={20} />
            </button>
            <button
              type="button"
              className="hx-rail-btn"
              onClick={() => {
                setDrawerOpen(false);
                setNotesFocus(null);
                setNotesOpen(true);
              }}
              aria-label="Project notes and history"
              title="Notes and history"
            >
              <IconNote size={20} />
            </button>
            <button
              type="button"
              className="hx-rail-btn"
              onClick={() => {
                setDrawerOpen(false);
                setPanelOpen(true);
              }}
              aria-label="Settings"
              title="Settings"
            >
              <IconSettings size={20} />
            </button>
            <span className="hx-rail-spacer" aria-hidden="true" />
            <button
              type="button"
              className="hx-rail-btn"
              onClick={() => setInspectorOpen((open) => !open)}
              aria-label="Toggle intelligence inspector"
              title="Inspector"
            >
              <IconInsight size={19} />
            </button>
          </nav>

          <main className="hx-work">
            <ArtStage
              phase={motionPhase}
              visionPhase={visionPhase}
              statusLabel={PHASE_LABEL[motionPhase]}
              visionStatus={VISION_LABEL[visionPhase]}
              mode={conversation ? "conversation" : "welcome"}
              expanded={stageExpanded}
              onToggleExpanded={() => setStageExpanded((open) => !open)}
              getMicAnalyser={() => micAnalyserRef.current}
              getPlaybackAnalyser={voice.getAnalyser}
              videoRef={vision.videoRef}
              frozen={vision.frozen}
              selection={selection}
              selectMode={selectMode}
              onSelection={(rect) => {
                setSelection(rect);
                setSelectMode(false);
                if (rect) {
                  pushNotice(
                    `Selected the ${selectionLabel(rect)} area of the frame. Ask about it, or say “idi enti?” / “explain this”.`,
                  );
                }
              }}
              onSelectMode={setSelectMode}
              onStopVision={() => vision.disable()}
              onSwitchCamera={() => void vision.switchCamera()}
              visionBusy={vision.busy}
            />

            <div className="hx-prompt">
              <span className="hx-prompt-mark" aria-hidden="true">
                H
              </span>
              <div>
                <div className="hx-prompt-title">{conversation ? "HYDRO" : "How can I help?"}</div>
                <div className="hx-prompt-sub">
                  Telugu, English, or both — type, speak, or show me.
                </div>
              </div>
              <div className="hx-actions">
                <button
                  type="button"
                  className="hx-talk"
                  data-state={
                    captureState === "listening"
                      ? "listening"
                      : captureState === "requesting"
                        ? "requesting"
                        : captureState === "transcribing"
                          ? "transcribing"
                          : "idle"
                  }
                  onClick={() => {
                    if (captureState === "listening") composerRef.current?.finish();
                    else composerRef.current?.start();
                  }}
                  disabled={!caps.stt || captureState === "transcribing"}
                  aria-label={
                    captureState === "listening"
                      ? "Listening — tap to finish"
                      : "Tap to speak to HYDRO"
                  }
                >
                  <IconMic size={18} />
                  {talkLabel}
                </button>
                <button
                  type="button"
                  className="hx-vision"
                  data-state={vision.status === "live" ? "live" : visionPhase}
                  onClick={() => {
                    if (vision.status === "live") vision.disable();
                    else void vision.enable();
                  }}
                  disabled={vision.busy || vision.status === "requesting"}
                  aria-label={
                    vision.status === "live"
                      ? "Stop vision and release the camera"
                      : "Start vision and request the camera"
                  }
                >
                  <span className="hx-vision-eye" aria-hidden="true" />
                  <span>{visionLabel}</span>
                </button>
              </div>
            </div>

            {conversation ? (
              <div className="hx-scroll" ref={scrollerRef}>
                <div className="hx-thread">
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div className="hx-msg" data-role="user" key={m.id}>
                        {m.content}
                        {m.via && m.via !== "typed" && (
                          <span className="msg-channel">{CHANNEL_LABEL[m.via]}</span>
                        )}
                      </div>
                    ) : (
                      <div
                        className="hx-msg"
                        data-role="assistant"
                        data-channel={m.via === "control" ? "control" : undefined}
                        key={m.id}
                      >
                        <div className="msg-assistant-head">
                          <span>HYDRO</span>
                          {m.via === "control" && <span className="msg-channel">interaction</span>}
                          {m.via === "vision" && <span className="msg-channel">camera</span>}
                          {m.via === "presence" && (
                            <span className="msg-channel">camera noticed you</span>
                          )}
                          {m.meta && (
                            <span>
                              {m.meta.mode} · {(m.meta.latencyMs / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>

                        <div className="msg-assistant-body">
                          {m.content ? (
                            <Markdown text={m.content} />
                          ) : m.pending ? (
                            <span style={{ color: "rgba(200,191,198,0.7)" }}>Thinking…</span>
                          ) : null}
                          {m.pending && m.content && <span className="caret" aria-hidden="true" />}
                        </div>

                        {m.error && <div className="err">{m.error}</div>}
                        {m.meta?.notice && <div className="notice">{m.meta.notice}</div>}

                        {(m.meta || m.content) && !m.pending && (
                          <div className="hx-msg-tools">
                            {m.meta && (
                              <button type="button" onClick={() => openInspector(m.id)}>
                                <IconInsight size={12} />
                                {m.meta.agents.length} agent
                                {m.meta.agents.length === 1 ? "" : "s"} · {m.meta.calls} call
                                {m.meta.calls === 1 ? "" : "s"} · ${m.meta.costUsd.toFixed(4)}
                              </button>
                            )}
                            {m.meta && m.meta.claims.some((c) => c.status === "verified") && (
                              <span className="badge" data-tone="ok">
                                {
                                  m.meta.claims.filter((c) => c.status === "verified").length
                                }{" "}
                                source-backed
                              </span>
                            )}
                            {m.meta?.degraded && (
                              <span className="badge" data-tone="warn">
                                recovered
                              </span>
                            )}
                            {m.content && (
                              <button
                                type="button"
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(m.content)
                                    .catch(() => undefined)
                                }
                              >
                                <IconCopy size={12} /> Copy
                              </button>
                            )}
                            {caps.tts && m.content && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (voice.speaking) {
                                    voice.stop();
                                    return;
                                  }
                                  spokenRef.current = m.content;
                                  void voice.speak(m.content, interaction.prosody());
                                }}
                              >
                                {voice.speaking ? (
                                  <IconVolumeOff size={12} />
                                ) : (
                                  <IconVolume size={12} />
                                )}
                                {voice.speaking ? "Stop" : "Listen"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="hx-hero">
                <div className="hx-hero-chips">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="hx-chip"
                      onClick={() => void send(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {voice.speaking && voice.settings.subtitles && voice.subtitle && (
              <div className="hx-subtitle" aria-live="polite">
                <span className="hx-subtitle-dot" aria-hidden="true" />
                {voice.subtitle}
              </div>
            )}

            <Composer
              ref={composerRef}
              mode={mode}
              onModeChange={setMode}
              onSend={(text) => void send(text)}
              onVoiceSend={(text) => void send(text, "spoken")}
              onStop={stop}
              busy={busy}
              sttEnabled={caps.stt}
              ttsEnabled={caps.tts}
              onListeningChange={(listening) => {
                setListening(listening);
                // Speaking while listening would let HYDRO hear itself; honour the
                // user's interruption preference rather than deciding for them.
                if (listening && voice.settings.interruptions) voice.stop();
              }}
              onCaptureState={setCaptureState}
              onAnalyserChange={(analyser) => {
                micAnalyserRef.current = analyser;
              }}
              replyLanguage={replyLang}
              onLanguageChange={setReplyLang}
              autoSpeak={autoSpeak}
              onAutoSpeakChange={(on) => {
                setAutoSpeak(on);
                if (!on) voice.stop();
              }}
              draft={draft}
              onDraftChange={(next) => {
                setDraft(next);
                activityRef.current = 1;
              }}
              onSpeechSample={(sample) => affect.setVoiceTone(sample.tone)}
              liveTranscript={liveTranscript}
              liveActive={live.listening}
              liveTranscribing={live.transcribing}
            />
          </main>
        </div>

        <Inspector
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          meta={inspectorMeta}
          trace={inspectorTrace}
          live={busy}
        />

        <VisionDock
          vision={vision}
          interaction={interaction}
          affect={affect}
          onObserve={() => void observe()}
          onReadText={() => void observe(READ_TEXT_QUESTION)}
          observeBusy={observeBusy}
          onPrompt={(text) => void send(text)}
          liveMode={liveMode}
          onModeChange={(next) => applyMode(next, true)}
          liveSession={live}
          liveCommand={liveCommand}
          onEmergencyStop={stop}
          replying={busy}
          selection={selection}
          onSelection={(rect) => {
            setSelection(rect);
            setSelectMode(false);
          }}
          selectMode={selectMode}
          onSelectMode={setSelectMode}
          onAskSelection={() =>
            void observe(
              "Look only at the selected region. Say what it is, then — if it is a diagram, page or interface — list its steps or labels in order.",
            )
          }
          ocrText={ocrText}
          ocrNote={ocrNote}
          onCopyText={() => {
            void navigator.clipboard.writeText(ocrText).catch(() =>
              pushNotice("Clipboard is blocked in this browser — select the text and copy it."),
            );
          }}
          onTranslateText={() => void translateOcr()}
          onSaveOcr={() => {
            if (!ocrText) return;
            void saveNote({ title: "Read text" }, ocrText);
          }}
          onOpenNotes={() => {
            setNotesFocus(null);
            setNotesOpen(true);
          }}
          onFreeze={() => {
            const held = vision.freeze();
            if (!held) pushNotice("There is no frame to freeze yet — start the camera first.");
          }}
          onUnfreeze={() => vision.unfreeze()}
        />
      </div>

      <Panels open={panelOpen} onClose={() => setPanelOpen(false)} voice={voice} />
      <NotesDrawer
        open={notesOpen}
        onClose={() => {
          setNotesOpen(false);
          setNotesFocus(null);
        }}
        focusPath={notesFocus}
        refreshKey={notesRefresh}
        project={project}
        onProjectChange={setProject}
      />
      <WorkspacePanel
        open={workspaceOpen}
        onClose={() => {
          setWorkspaceOpen(false);
          setPendingPlan(null);
        }}
        initialPlan={pendingPlan}
        onPlanHandled={() => setPendingPlan(null)}
        onRunning={(running) =>
          interaction.push({
            kind: "activity",
            activity: "executing",
            on: running,
            ms: 120_000,
          })
        }
      />
    </>
  );
}
