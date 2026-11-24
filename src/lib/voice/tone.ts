"use client";

/**
 * HYDRO AI — microphone acoustic meter.
 *
 * While the user records a voice message this samples the microphone stream and
 * keeps four numbers: loudness, loudness variation, pitch and pitch variation,
 * plus the share of frames that actually contained voice. Nothing is recorded,
 * stored or uploaded by this module — the recording itself is sent for
 * transcription by the composer, and these measurements stay in the tab.
 *
 * It measures sound, not feelings. `src/core/affect.ts` decides how much a
 * louder or faster voice is allowed to influence the reply tone.
 */

import { estimatePitchHz, type VoiceTone } from "@/core/affect";

const SAMPLE_INTERVAL_MS = 60;

export class ToneMeter {
  private stream: MediaStream;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: number | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;

  private frames = 0;
  private voiced = 0;
  private energies: number[] = [];
  private pitches: number[] = [];
  private startedAt = 0;

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  async start(): Promise<void> {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const source = ctx.createMediaStreamSource(this.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      // Not connected to the destination: monitoring the mic would feed back.
      source.connect(analyser);
      this.ctx = ctx;
      this.source = source;
      this.analyser = analyser;
      this.buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      this.startedAt = performance.now();
      this.timer = window.setInterval(() => this.frame(), SAMPLE_INTERVAL_MS);
      this.frame();
    } catch {
      // Metering is optional: a denied AudioContext leaves the voice path intact.
    }
  }

  /** The analyser sampling this stream, for amplitude-driven UI. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  private frame(): void {
    const analyser = this.analyser;
    const buffer = this.buffer;
    const ctx = this.ctx;
    if (!analyser || !buffer || !ctx) return;

    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / buffer.length);
    this.frames += 1;
    if (rms < 0.006) return;

    this.voiced += 1;
    this.energies.push(rms);
    const pitch = estimatePitchHz(buffer, ctx.sampleRate);
    if (pitch >= 60 && pitch <= 420) this.pitches.push(pitch);
  }

  /** Stop sampling and return the measurements gathered so far. */
  stop(wordsPerMinute?: number): VoiceTone {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    void this.ctx?.close().catch(() => undefined);

    const energies = this.energies;
    const pitches = this.pitches;
    const mean = (values: number[]) =>
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const sd = (values: number[], avg: number) =>
      values.length > 1
        ? Math.sqrt(values.reduce((sum, v) => sum + (v - avg) * (v - avg), 0) / values.length)
        : 0;

    const energy = mean(energies);
    const pitchHz = median(pitches);
    const semitones = pitches.map((f) => 12 * Math.log2(f / 100));

    const result: VoiceTone = {
      frames: this.frames,
      voicedRatio: this.frames ? this.voiced / this.frames : 0,
      energy: Math.round(energy * 10_000) / 10_000,
      energyVar: Math.round(sd(energies, energy) * 10_000) / 10_000,
      pitchHz: Math.round(pitchHz),
      pitchVar: Math.round(sd(semitones, mean(semitones)) * 100) / 100,
      wordsPerMinute,
    };

    this.frames = 0;
    this.voiced = 0;
    this.energies = [];
    this.pitches = [];
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.buffer = null;
    return result;
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Words per minute from a transcript and a recording length. */
export function speakingRate(transcript: string, durationMs: number): number | undefined {
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  if (!words || durationMs < 1500) return undefined;
  return Math.round(words / (durationMs / 60_000));
}
