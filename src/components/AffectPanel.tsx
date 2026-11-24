"use client";

/**
 * AFFECT panel — the honest surface of the affect layer.
 *
 * It shows what was actually measured (cue words, confidence, acoustic numbers),
 * lets the user state their mood directly, and owns the consent switch for the
 * on-device episode log. The breathing pacer is a real timed exercise, not an
 * animation: it counts through four 4-4-6 cycles and stops.
 */

import { useEffect, useRef, useState } from "react";
import {
  MOOD_LABELS,
  TONE_LABELS,
  episodeAge,
  followUpPrompt,
  recommend,
  type Mood,
} from "@/core/affect";
import type { AffectApi } from "@/lib/useAffect";

const MOODS: Mood[] = ["good", "okay", "stressed", "sad"];

interface Props {
  affect: AffectApi;
  onPrompt: (text: string) => void;
}

export default function AffectPanel({ affect, onPrompt }: Props) {
  const read = affect.lastRead;
  const [breathing, setBreathing] = useState(false);
  const [breathPhase, setBreathPhase] = useState("Ready");
  const [breathLeft, setBreathLeft] = useState(0);
  const [breathDone, setBreathDone] = useState(false);
  const startedRef = useRef(0);

  useEffect(() => {
    if (!breathing) return;
    startedRef.current = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - startedRef.current) / 1000;
      const cycle = 14; // 4 in · 4 hold · 6 out
      const cycles = 4;
      if (elapsed >= cycle * cycles) {
        setBreathing(false);
        setBreathDone(true);
        setBreathPhase("Done");
        setBreathLeft(0);
        return;
      }
      const within = elapsed % cycle;
      if (within < 4) {
        setBreathPhase("Breathe in");
        setBreathLeft(Math.ceil(4 - within));
      } else if (within < 8) {
        setBreathPhase("Hold");
        setBreathLeft(Math.ceil(8 - within));
      } else {
        setBreathPhase("Breathe out");
        setBreathLeft(Math.ceil(cycle - within));
      }
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [breathing]);

  const recs = recommend(read);
  const tone = read.uncertain && !read.mood ? "neutral" : read.tone;

  return (
    <div className="affect">
      <div className="affect-head">
        <span className="vision-title">AFFECT</span>
        <span className="affect-conf">
          {read.sources.length
            ? `${Math.round(read.confidence * 100)}% confidence`
            : "no signals yet"}
        </span>
      </div>

      <div className="affect-moods" role="group" aria-label="How are you feeling right now?">
        {MOODS.map((mood) => (
          <button
            key={mood}
            type="button"
            className="affect-mood"
            data-active={affect.mood === mood}
            aria-pressed={affect.mood === mood}
            onClick={() => affect.setMood(affect.mood === mood ? null : mood)}
          >
            {MOOD_LABELS[mood]}
          </button>
        ))}
      </div>

      <div className="vision-row" data-tone={read.uncertain ? "warn" : "ok"}>
        <span className="vision-key">reply tone</span>
        <span className="vision-val">{TONE_LABELS[tone]}</span>
      </div>

      {read.cues.length ? (
        <div className="vision-row" data-tone="idle">
          <span className="vision-key">cues</span>
          <span className="vision-val">{read.cues.join(" · ")}</span>
        </div>
      ) : null}

      {read.uncertain && read.sources.length > 0 && (
        <div className="affect-check" role="status">
          <p>
            {read.checkIn
              ? "Your words and visible cues disagree, so I can't read this reliably."
              : "There isn't enough signal to read this reliably."}{" "}
            How are you feeling right now?
          </p>
          <div className="affect-moods">
            {MOODS.map((mood) => (
              <button
                key={mood}
                type="button"
                className="affect-mood"
                data-active={affect.mood === mood}
                onClick={() => affect.setMood(mood)}
              >
                {MOOD_LABELS[mood]}
              </button>
            ))}
          </div>
        </div>
      )}

      {affect.voiceTone && affect.voiceTone.frames > 0 && (
        <div className="affect-voice">
          last voice sample · {affect.voiceTone.pitchHz || "—"} Hz ·{" "}
          {affect.voiceTone.wordsPerMinute ? `${affect.voiceTone.wordsPerMinute} wpm · ` : ""}
          loudness {affect.voiceTone.energy.toFixed(3)}
        </div>
      )}

      {recs.length > 0 && (
        <div className="affect-recs">
          {recs.map((rec) =>
            rec.id === "breathe" ? (
              <button
                key={rec.id}
                type="button"
                className="vision-btn"
                onClick={() => {
                  setBreathDone(false);
                  setBreathing((v) => !v);
                }}
              >
                {breathing ? "Stop breathing exercise" : breathDone ? "Again: 60-second breathing" : rec.label}
              </button>
            ) : (
              <button
                key={rec.id}
                type="button"
                className="vision-btn"
                onClick={() => onPrompt(rec.prompt)}
              >
                {rec.label}
              </button>
            ),
          )}
        </div>
      )}

      {(breathing || breathDone) && (
        <div className="affect-breath" aria-live="polite">
          <strong>{breathPhase}</strong>
          {breathing && <span>{breathLeft}s</span>}
          {!breathing && breathDone && <span>Four cycles complete.</span>}
        </div>
      )}

      {affect.followUp && (
        <div className="affect-follow">
          <p>
            You marked your mood as {MOOD_LABELS[affect.followUp.mood ?? "okay"].toLowerCase()}{" "}
            {episodeAge(affect.followUp.at)}. Pick it up?
          </p>
          <button
            type="button"
            className="vision-btn"
            onClick={() => onPrompt(followUpPrompt(affect.followUp!))}
          >
            Continue that thread
          </button>
        </div>
      )}

      <details className="vision-settings">
        <summary>Mood memory & privacy</summary>
        <label className="vision-check">
          <input
            type="checkbox"
            checked={affect.consent}
            onChange={(e) => affect.setConsent(e.target.checked)}
          />
          <span>Keep an on-device mood log ({affect.episodes.length})</span>
        </label>
        <label className="vision-check">
          <input
            type="checkbox"
            checked={affect.calmPref}
            onChange={(e) => affect.setCalm(e.target.checked)}
          />
          <span>Soften colours when strain is high</span>
        </label>
        {affect.consent && affect.episodes.length > 0 && (
          <button type="button" className="vision-btn" onClick={affect.clearEpisodes}>
            Delete mood log
          </button>
        )}
        <p className="vision-privacy">
          Face and voice numbers are computed in this tab and are not uploaded. A mood log stays in
          this browser, only after you switch it on, and only records your own mood taps plus a
          90-character excerpt. The chat request carries a tone label only. Face and voice are cues,
          not emotion recognition, and nothing here is a diagnosis.
        </p>
      </details>
    </div>
  );
}
