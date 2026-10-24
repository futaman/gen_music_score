// 再生。楽器ごとのサンプル（public/samples）を Tone.Sampler で鳴らす。
// 少し先（LOOKAHEAD 秒）までの音だけを予約し、一時停止・テンポ変更にすぐ応じられるようにする。

import * as Tone from 'tone';
import { getInstrument } from '../core/instruments';
import type { Part } from '../core/model/types';
import type { Timeline } from '../core/playback/timeline';

const LOOKAHEAD = 0.3;
const TICK_MS = 50;

type Manifest = Record<string, string[]>;
let manifestPromise: Promise<Manifest> | undefined;
const buffersBySample = new Map<string, Promise<Tone.ToneAudioBuffers>>();

const sampleBase = () => `${import.meta.env.BASE_URL}samples/`;

function manifest(): Promise<Manifest> {
  manifestPromise ??= fetch(`${sampleBase()}manifest.json`).then((r) => r.json() as Promise<Manifest>);
  return manifestPromise;
}

/** 'Fs4' → 'F#4'（Tone の音名） */
const toneNote = (file: string) => file.replace(/^([A-G])s/, '$1#');

function loadBuffers(sample: string): Promise<Tone.ToneAudioBuffers> {
  let p = buffersBySample.get(sample);
  if (!p) {
    p = manifest().then(
      (m) =>
        new Promise<Tone.ToneAudioBuffers>((resolve, reject) => {
          const urls = Object.fromEntries((m[sample] ?? []).map((f) => [toneNote(f), `${f}.mp3`]));
          const buffers = new Tone.ToneAudioBuffers({
            urls,
            baseUrl: `${sampleBase()}${sample}/`,
            onload: () => resolve(buffers),
            onerror: (e) => reject(e),
          });
        }),
    );
    buffersBySample.set(sample, p);
  }
  return p;
}

export type PlayerState = 'stopped' | 'loading' | 'playing' | 'paused';

export class Player {
  state: PlayerState = 'stopped';
  /** 再生位置（秒。テンポ等倍のときの時間） */
  position = 0;
  rate = 1;
  private listeners = new Set<() => void>();
  private version = 0;

  /** React の useSyncExternalStore 用 */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private timeline: Timeline = { events: [], measures: [], duration: 0 };
  private voices = new Map<string, { sampler: Tone.Sampler; gain: Tone.Gain }>();
  private muted = new Set<string>();
  private solo = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private startCtx = 0;
  private startPos = 0;
  private next = 0; // 次に予約するイベント

  setTimeline(t: Timeline) {
    this.stop();
    this.timeline = t;
  }

  /** 使うパートのサンプルを読み込む（初回だけ時間がかかる） */
  async prepare(parts: Part[]) {
    await Promise.all(
      parts.map(async (p) => {
        if (this.voices.has(p.id)) return;
        const def = getInstrument(p.instrumentId);
        if (def.unpitched) return;
        const buffers = await loadBuffers(def.sample);
        const urls: Record<string, Tone.ToneAudioBuffer> = {};
        for (const f of (await manifest())[def.sample] ?? []) urls[toneNote(f)] = buffers.get(toneNote(f));
        const gain = new Tone.Gain(1).toDestination();
        const sampler = new Tone.Sampler({ urls, release: 0.25 }).connect(gain);
        this.voices.set(p.id, { sampler, gain });
      }),
    );
    this.applyMix();
  }

  async play(parts: Part[]) {
    if (this.state === 'playing') return;
    // iPhone などは、タップの中で音声を有効にする必要がある
    await Tone.start();
    if (this.voices.size < parts.length) {
      this.set('loading');
      await this.prepare(parts);
    }
    if (this.position >= this.timeline.duration) this.position = 0;
    this.startCtx = Tone.now() + 0.08;
    this.startPos = this.position;
    this.next = this.timeline.events.findIndex((e) => e.time >= this.position);
    if (this.next < 0) this.next = this.timeline.events.length;
    this.set('playing');
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.position = this.now();
    this.halt();
    this.set('paused');
  }

  stop() {
    this.halt();
    this.position = 0;
    this.set('stopped');
  }

  seek(seconds: number) {
    const playing = this.state === 'playing';
    if (playing) this.halt();
    this.position = Math.max(0, Math.min(seconds, this.timeline.duration));
    if (playing) {
      this.state = 'paused';
      void this.play([]);
    } else this.emit();
  }

  setRate(rate: number) {
    if (this.state === 'playing') {
      const pos = this.now();
      this.halt();
      this.rate = rate;
      this.position = pos;
      this.state = 'paused';
      void this.play([]);
    } else {
      this.rate = rate;
      this.emit();
    }
  }

  setMute(partId: string, on: boolean) {
    if (on) this.muted.add(partId);
    else this.muted.delete(partId);
    this.applyMix();
  }

  setSolo(partId: string, on: boolean) {
    if (on) this.solo.add(partId);
    else this.solo.delete(partId);
    this.applyMix();
  }

  isMuted = (partId: string) => this.muted.has(partId);
  isSolo = (partId: string) => this.solo.has(partId);

  /** 今の再生位置（秒、テンポ等倍の時間） */
  now(): number {
    if (this.state !== 'playing') return this.position;
    return Math.min(this.timeline.duration, this.startPos + Math.max(0, Tone.now() - this.startCtx) * this.rate);
  }

  dispose() {
    this.halt();
    for (const v of this.voices.values()) {
      v.sampler.dispose();
      v.gain.dispose();
    }
    this.voices.clear();
  }

  private tick() {
    const pos = this.now();
    if (pos >= this.timeline.duration) {
      this.halt();
      this.position = this.timeline.duration;
      this.set('stopped');
      return;
    }
    const horizon = pos + LOOKAHEAD * this.rate;
    const events = this.timeline.events;
    while (this.next < events.length && events[this.next].time < horizon) {
      const e = events[this.next++];
      const v = this.voices.get(e.partId);
      if (!v) continue;
      const at = this.startCtx + (e.time - this.startPos) / this.rate;
      v.sampler.triggerAttackRelease(
        Tone.Frequency(e.midi, 'midi').toFrequency(),
        e.duration / this.rate,
        Math.max(at, Tone.now()),
        e.velocity,
      );
    }
  }

  private halt() {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const v of this.voices.values()) v.sampler.releaseAll();
  }

  private applyMix() {
    for (const [id, v] of this.voices) {
      const audible = !this.muted.has(id) && (this.solo.size === 0 || this.solo.has(id));
      v.gain.gain.rampTo(audible ? 1 : 0, 0.05);
    }
    this.emit();
  }

  private set(state: PlayerState) {
    this.state = state;
    this.emit();
  }
}
