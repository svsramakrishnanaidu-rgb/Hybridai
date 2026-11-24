"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VoiceApi } from "@/lib/useVoice";
import type { SpeechSettings, SpeechMode } from "@/core/speech/settings";
import type { VoiceOption, VoiceStyle } from "@/core/speech/voices";

interface ModelRow {
  id: string;
  label: string;
  languages: number;
  streaming: boolean;
  measuredLatencyMs: number | null;
  acceptsLanguageCode: boolean;
}

interface Capabilities {
  capabilities: { stt: boolean; tts: boolean };
  models: ModelRow[];
  languages: Array<{ id: string; label: string; native: string }>;
  unsupported: string[];
  voices: VoiceOption[];
  voicesLive: boolean;
  voicesTakenAt: string;
  nativeVoices: number;
  modes: Array<{ id: SpeechMode; label: string; description: string }>;
}

const STYLE_FILTERS: Array<{ id: VoiceStyle | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "warm", label: "Warm" },
  { id: "professional", label: "Professional" },
  { id: "narration", label: "Narration" },
  { id: "deep", label: "Deep" },
  { id: "gentle", label: "Gentle" },
  { id: "energetic", label: "Energetic" },
  { id: "conversational", label: "Casual" },
];

/**
 * HYDRO AI → Settings → Voice & Speech.
 *
 * Every control here maps to something the pipeline actually does. The pitch
 * slider is present but disabled with the reason, because the neural voice has
 * no pitch parameter and a working-looking slider would be a lie. Previews are
 * real synthesis requests for the language being configured, so the voice is
 * auditioned on the text it will actually read.
 */
export default function VoiceSettings({ voice }: { voice: VoiceApi }) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<VoiceStyle | "all">("all");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [word, setWord] = useState("");
  const [say, setSay] = useState("");
  const [ruleLang, setRuleLang] = useState("any");
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/capabilities");
      if (!res.ok) throw new Error(`Voice capabilities unavailable (${res.status})`);
      setCaps((await res.json()) as Capabilities);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load voice capabilities");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      previewRef.current?.pause();
      previewRef.current = null;
    };
  }, []);

  const settings = voice.settings;
  const patch = (next: Partial<SpeechSettings>) => void voice.updateSettings(next);

  const voices = useMemo(() => {
    if (!caps) return [];
    const needle = query.trim().toLowerCase();
    return caps.voices.filter((option) => {
      if (style !== "all" && !option.styles.includes(style)) return false;
      if (!needle) return true;
      return `${option.name} ${option.description} ${option.accent} ${option.gender} ${option.styles.join(" ")}`
        .toLowerCase()
        .includes(needle);
    });
  }, [caps, query, style]);

  const preview = async (option: VoiceOption) => {
    if (previewing) return;
    setPreviewing(option.id);
    setError(null);
    try {
      const res = await fetch("/api/voice/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voiceId: option.id,
          language: settings.language === "auto" ? "en" : settings.language,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Preview failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      previewRef.current?.pause();
      const audio = new Audio(url);
      previewRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(null);
    }
  };

  const addRule = async () => {
    if (!word.trim() || !say.trim()) return;
    const res = await fetch("/api/voice/pronunciation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word, say, language: ruleLang }),
    });
    const data = (await res.json()) as { rules?: SpeechSettings["pronunciation"]; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not save that pronunciation");
      return;
    }
    if (data.rules) await voice.updateSettings({ pronunciation: data.rules });
    setWord("");
    setSay("");
  };

  const deleteRule = async (id: string) => {
    const res = await fetch(`/api/voice/pronunciation?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = (await res.json()) as { rules?: SpeechSettings["pronunciation"] };
    if (data.rules) await voice.updateSettings({ pronunciation: data.rules });
  };

  const reset = () => {
    if (!window.confirm("Reset voice and speech settings to their defaults? Your pronunciation rules are kept.")) {
      return;
    }
    patch({
      enabled: true,
      autoRead: true,
      language: "auto",
      voiceId: null,
      mode: "natural",
      speed: 1,
      volume: 0.9,
      expressiveness: "medium",
      style: "natural",
      pauses: "natural",
      quality: "high",
      streaming: true,
      subtitles: true,
      interruptions: true,
    });
  };

  const selectedVoice = caps?.voices.find((option) => option.id === settings.voiceId) ?? null;
  const languageLabel =
    settings.language === "auto"
      ? "Auto detect"
      : (caps?.languages.find((language) => language.id === settings.language)?.label ?? settings.language);

  return (
    <>
      <div className="panel-title">Voice &amp; speech</div>

      {error && (
        <div className="card" data-tone="warn">
          <div className="card-body">{error}</div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">Engine</span>
          <span className="badge" data-tone={caps?.capabilities.tts ? "ok" : "warn"}>
            {caps?.capabilities.tts ? "neural voice ready" : "no speech key"}
          </span>
        </div>
        <div className="card-body">
          {voice.stats.engine === "browser"
            ? "Last answer used this browser's speech engine (fallback)."
            : voice.stats.model
              ? `Last answer: ${voice.stats.model} · ${voice.stats.language?.toUpperCase()} · ${voice.stats.spokenSegments}/${voice.stats.segments} sentences` +
                (voice.stats.firstAudioMs ? ` · first audio ${(voice.stats.firstAudioMs / 1000).toFixed(2)} s` : "")
              : "Nothing spoken yet in this tab."}
        </div>
        {voice.stats.notes.length > 0 && (
          <div className="card-body" style={{ opacity: 0.75, marginTop: 6 }}>
            Text rewritten for speech: {voice.stats.notes.join(" · ")}
          </div>
        )}
        {(voice.stats.notice || voice.stats.voiceNotice) && (
          <div className="card-body" style={{ marginTop: 6, color: "#ffd8a8" }}>
            {voice.stats.notice ?? voice.stats.voiceNotice}
          </div>
        )}
        <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
          <button type="button" className="ghost-btn" onClick={() => patch({ enabled: !settings.enabled })}>
            {settings.enabled ? "Spoken answers on" : "Spoken answers off"}
          </button>
          <button type="button" className="ghost-btn" onClick={() => patch({ autoRead: !settings.autoRead })}>
            {settings.autoRead ? "Auto-read on" : "Auto-read off"}
          </button>
          {voice.speaking && (
            <>
              <button type="button" className="ghost-btn" onClick={() => void (voice.paused ? voice.resume() : voice.pause())}>
                {voice.paused ? "Resume" : "Pause"}
              </button>
              <button type="button" className="ghost-btn" data-danger="true" onClick={voice.stop}>
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      <div className="sec-label">Voice library · {caps?.voices.length ?? 0} available</div>
      <div className="card-body" style={{ marginBottom: 8 }}>
        {caps?.voicesLive
          ? `Read live from the provider ${caps.voicesTakenAt.slice(11, 16)} UTC.`
          : "Provider not reachable — this is the last verified snapshot, not a live list."}{" "}
        {caps ? `${caps.nativeVoices} of them are native English voices.` : ""}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          className="field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search voices — warm, deep, educator…"
          aria-label="Search voices"
        />
        <select
          className="field"
          value={style}
          onChange={(event) => setStyle(event.target.value as VoiceStyle | "all")}
          aria-label="Filter by style"
          style={{ maxWidth: 130 }}
        >
          {STYLE_FILTERS.map((filter) => (
            <option key={filter.id} value={filter.id}>
              {filter.label}
            </option>
          ))}
        </select>
      </div>

      <div className="voice-list">
        {voices.map((option) => {
          const active = option.id === settings.voiceId;
          return (
            <div className="voice-row" key={option.id} data-active={active}>
              <div className="mem-body">
                <span className="voice-name">{option.name}</span>{" "}
                <span className="badge" data-tone="info">
                  {option.gender}
                </span>{" "}
                <span className="badge">{option.accent}</span>
                <div className="mem-meta">{option.description || option.styles.join(" · ")}</div>
              </div>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void preview(option)}
                disabled={previewing === option.id || !caps?.capabilities.tts}
                aria-label={`Preview ${option.name}`}
              >
                {previewing === option.id ? "…" : "Preview"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                data-on={active}
                onClick={() => patch({ voiceId: active ? null : option.id })}
              >
                {active ? "Selected" : "Use"}
              </button>
            </div>
          );
        })}
        {caps && voices.length === 0 && <div className="card-body">No voice matches that filter.</div>}
      </div>

      <div className="sec-label">Customisation</div>

      <div className="card">
        <label className="voice-field">
          <span>Language</span>
          <select
            className="field"
            value={settings.language}
            onChange={(event) => patch({ language: event.target.value })}
          >
            <option value="auto">Auto detect</option>
            {(caps?.languages ?? []).map((language) => (
              <option key={language.id} value={language.id}>
                {language.label} — {language.native}
              </option>
            ))}
          </select>
        </label>
        <div className="card-body">
          {settings.language === "auto"
            ? "Detected per answer from the script, including romanised Telugu."
            : `Every answer is spoken as ${languageLabel}.`}
          {caps && caps.unsupported.length > 0 && (
            <>
              {" "}
              Not listed by any configured model: {caps.unsupported.join(", ")}.
            </>
          )}
        </div>

        <label className="voice-field">
          <span>Speech speed · {settings.speed.toFixed(2)}×</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={settings.speed}
            onChange={(event) => patch({ speed: Number(event.target.value) })}
            aria-label="Speech speed"
          />
        </label>

        <label className="voice-field">
          <span>Output volume · {Math.round(settings.volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(event) => patch({ volume: Number(event.target.value) })}
            aria-label="Output volume"
          />
        </label>

        <label className="voice-field" data-disabled="true">
          <span>Voice pitch · not supported</span>
          <input type="range" min={-2} max={3} step={0.5} value={0} disabled aria-label="Voice pitch (unavailable)" />
        </label>
        <div className="card-body">
          The configured neural voice has no pitch parameter. Pitch is only available when the browser's own
          speech engine is used as a fallback, so this control is disabled rather than simulated.
        </div>

        <label className="voice-field">
          <span>Expressiveness</span>
          <select
            className="field"
            value={settings.expressiveness}
            onChange={(event) => patch({ expressiveness: event.target.value as SpeechSettings["expressiveness"] })}
          >
            <option value="low">Low — steady and flat</option>
            <option value="medium">Medium — conversational</option>
            <option value="high">High — animated</option>
          </select>
        </label>

        <label className="voice-field">
          <span>Speaking style</span>
          <select
            className="field"
            value={settings.style}
            onChange={(event) => patch({ style: event.target.value as SpeechSettings["style"] })}
          >
            <option value="natural">Natural</option>
            <option value="professional">Professional</option>
            <option value="story">Story</option>
            <option value="energetic">Energetic</option>
          </select>
        </label>

        <label className="voice-field">
          <span>Pauses between sentences</span>
          <select
            className="field"
            value={settings.pauses}
            onChange={(event) => patch({ pauses: event.target.value as SpeechSettings["pauses"] })}
          >
            <option value="short">Short</option>
            <option value="natural">Natural</option>
            <option value="extended">Extended</option>
          </select>
        </label>

        <label className="voice-field">
          <span>Audio quality</span>
          <select
            className="field"
            value={settings.quality}
            onChange={(event) => patch({ quality: event.target.value as SpeechSettings["quality"] })}
          >
            <option value="standard">Standard — fastest</option>
            <option value="high">High — 44.1 kHz</option>
            <option value="best">Best available — slower</option>
          </select>
        </label>
      </div>

      <div className="sec-label">Playback</div>
      <div className="card">
        {(
          [
            ["streaming", "Streaming playback", "Start speaking after the first sentence instead of the whole answer."],
            ["subtitles", "Subtitles", "Show the sentence being spoken under the conversation."],
            ["interruptions", "Voice interruptions", "Let the microphone or a new message cut speech off."],
          ] as Array<[keyof SpeechSettings, string, string]>
        ).map(([key, label, hint]) => (
          <label className="toggle" key={key}>
            <span className="switch" data-on={Boolean(settings[key])} />
            <input
              type="checkbox"
              hidden
              checked={Boolean(settings[key])}
              onChange={(event) => patch({ [key]: event.target.checked } as Partial<SpeechSettings>)}
            />
            {label}
            <span className="voice-hint">{hint}</span>
          </label>
        ))}
      </div>

      <div className="sec-label">Modes</div>
      <div className="voice-modes">
        {(caps?.modes ?? []).map((mode) => (
          <button
            key={mode.id}
            type="button"
            className="ghost-btn"
            data-on={settings.mode === mode.id}
            title={mode.description}
            onClick={() => patch({ mode: mode.id })}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="sec-label">Pronunciation dictionary · {settings.pronunciation.length}</div>
      <div className="card-body" style={{ marginBottom: 8 }}>
        Say how a name or term should be read. Rules apply before the technical lexicon and before Telugu
        transliteration, so they win.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          className="field"
          value={word}
          onChange={(event) => setWord(event.target.value)}
          placeholder="Word (e.g. DHRUVA)"
          aria-label="Word to pronounce"
          style={{ flex: "1 1 120px" }}
        />
        <input
          className="field"
          value={say}
          onChange={(event) => setSay(event.target.value)}
          placeholder="Say it as (e.g. DROO vaa)"
          aria-label="Preferred pronunciation"
          style={{ flex: "1 1 150px" }}
        />
        <select className="field" value={ruleLang} onChange={(event) => setRuleLang(event.target.value)} aria-label="Rule language" style={{ maxWidth: 110 }}>
          <option value="any">Any language</option>
          {(caps?.languages ?? []).map((language) => (
            <option key={language.id} value={language.id}>
              {language.id}
            </option>
          ))}
        </select>
        <button type="button" className="ghost-btn" onClick={() => void addRule()} disabled={!word.trim() || !say.trim()}>
          Add rule
        </button>
      </div>
      {settings.pronunciation.map((rule) => (
        <div className="mem-row" key={rule.id}>
          <div className="mem-body">
            {rule.word} → {rule.say}
            <div className="mem-meta">{rule.language === "any" ? "any language" : rule.language}</div>
          </div>
          <button type="button" className="ghost-btn" data-danger="true" onClick={() => void deleteRule(rule.id)}>
            Delete
          </button>
        </div>
      ))}

      <div className="sec-label">Measured model capability</div>
      <div className="card-body" style={{ marginBottom: 8 }}>
        Language counts come from the provider's own model list. Latency is the measured wall-clock time in this
        workspace for one short sentence.
      </div>
      {(caps?.models ?? []).map((model) => (
        <div className="mem-row" key={model.id}>
          <div className="mem-body">
            {model.label}
            <div className="mem-meta">
              {model.languages} languages · {model.measuredLatencyMs ? `${model.measuredLatencyMs} ms` : "not measured"} ·
              {model.streaming ? " streaming" : " no streaming"}
              {model.acceptsLanguageCode ? " · honours language code" : ""}
            </div>
          </div>
          {voice.stats.model === model.id && (
            <span className="badge" data-tone="ok">
              in use
            </span>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="ghost-btn" onClick={reset}>
          Reset to defaults
        </button>
        <button type="button" className="ghost-btn" onClick={() => void load()}>
          Re-check provider
        </button>
        {selectedVoice && (
          <span className="card-body" style={{ alignSelf: "center" }}>
            Selected: {selectedVoice.name}
          </span>
        )}
      </div>
    </>
  );
}
