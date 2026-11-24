"use client";

/**
 * HYDRO AI — speech playback engine.
 *
 * Why not just `new Audio().play()` per sentence: an <audio> element re-buffers
 * and re-clocks on every `src` change, which produces the clipped first syllable
 * and the audible seam between sentences. This player decodes each sentence to
 * an AudioBuffer and schedules it on one AudioContext clock at an explicit start
 * time, so consecutive sentences are sample-accurate: no overlap, no gap longer
 * than the pause it was told to insert, and no restart artefact.
 *
 * The analyser sits after the gain node, so the hologram's mouth is driven by the
 * audio that is actually leaving the speakers, at the volume the user set.
 */

export interface ScheduledSpeech {
  index: number;
  text: string;
  displayText: string;
  /** AudioContext time the buffer starts */
  startAt: number;
  /** seconds */
  duration: number;
}

const LOOKAHEAD_S = 0.06;

export class SpeechPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private scheduled: ScheduledSpeech[] = [];
  private volume = 0.9;
  private paused = false;

  /** Create the audio graph on first use (needs a user gesture in most browsers). */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      gain.gain.value = this.volume;
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      this.ctx = ctx;
      this.gain = gain;
      this.analyser = analyser;
      this.data = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      return ctx;
    } catch {
      return null;
    }
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get isPlaying(): boolean {
    return this.sources.size > 0 && !this.paused;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.gain && this.ctx) {
      // A short ramp instead of a jump: a step change in gain is an audible click.
      this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  async resume(): Promise<void> {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    this.paused = false;
  }

  /** Decode provider audio into a buffer the scheduler can place precisely. */
  async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensure();
    if (!ctx) throw new Error("This browser cannot play audio.");
    return ctx.decodeAudioData(bytes.slice(0));
  }

  /**
   * Place one decoded sentence on the clock.
   * Returns the absolute start/end times so the caller knows when the next one
   * may begin.
   */
  schedule(
    buffer: AudioBuffer,
    meta: { index: number; text: string; displayText: string },
    pauseMs: number,
    at?: number,
  ): ScheduledSpeech {
    const ctx = this.ensure();
    if (!ctx || !this.gain) throw new Error("This browser cannot play audio.");

    const previous = this.scheduled[this.scheduled.length - 1];
    const desired = at ?? (previous ? previous.startAt + previous.duration + pauseMs / 1000 : 0);
    // Never schedule in the past: start just after now when the pipeline was slow.
    const startAt = Math.max(desired, ctx.currentTime + LOOKAHEAD_S);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
    };
    source.start(startAt);

    const entry: ScheduledSpeech = {
      index: meta.index,
      text: meta.text,
      displayText: meta.displayText,
      startAt,
      duration: buffer.duration,
    };
    this.scheduled.push(entry);
    return entry;
  }

  /** The sentence being spoken at `at` (defaults to now), or null in a pause. */
  active(at?: number): ScheduledSpeech | null {
    const time = at ?? this.now;
    for (const entry of this.scheduled) {
      if (time >= entry.startAt && time < entry.startAt + entry.duration) return entry;
    }
    return null;
  }

  /** The most recently started sentence, for subtitles during a pause. */
  latest(): ScheduledSpeech | null {
    const time = this.now;
    let found: ScheduledSpeech | null = null;
    for (const entry of this.scheduled) {
      if (entry.startAt <= time) found = entry;
    }
    return found;
  }

  /** Measured playback amplitude 0…1, used by the hologram. */
  amplitude(): number {
    const analyser = this.analyser;
    const data = this.data;
    if (!analyser || !data || this.paused) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.min(1, rms * 3.2);
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Cancel everything that is queued or playing. */
  stop(): void {
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.scheduled = [];
    this.paused = false;
  }

  async pause(): Promise<void> {
    if (!this.ctx || this.paused) return;
    this.paused = true;
    await this.ctx.suspend().catch(() => undefined);
  }

  async unpause(): Promise<void> {
    if (!this.ctx || !this.paused) return;
    this.paused = false;
    await this.ctx.resume().catch(() => undefined);
  }

  /** Total scheduled speech remaining, seconds. */
  get remaining(): number {
    const last = this.scheduled[this.scheduled.length - 1];
    if (!last) return 0;
    return Math.max(0, last.startAt + last.duration - this.now);
  }
}
