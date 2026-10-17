import { speech } from './api';
import { trackVoicePlayback } from './playback-store';

export interface VoicePlayer {
  add(text: string): void;
  finish(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  playedText(): string;
}

type Item = { text: string; audio?: Promise<AudioBuffer> };

/** Solo sintetiza la oración actual y una de anticipación; nunca reproduce fuera de orden. */
export class AudioQueue implements VoicePlayer {
  private items: Item[] = [];
  private index = 0;
  private source?: AudioBufferSourceNode;
  private buffer?: AudioBuffer;
  private offset = 0;
  private startedAt = 0;
  private paused = false;
  private cancelled = false;
  private complete = false;
  private loading = false;
  private heard: string[] = [];
  private abort = new AbortController();
  private endPlayback?: () => void;

  constructor(private context: AudioContext, private events: {
    onStart(): void;
    onDone(): void;
    onError(error: unknown): void;
  }) {}

  add(text: string) {
    if (this.cancelled) return;
    this.items.push({ text });
    this.prefetch();
    void this.pump();
  }

  private prefetch() {
    for (let i = this.index; i < Math.min(this.items.length, this.index + 2); i++) {
      const item = this.items[i]!;
      if (!item.audio) {
        item.audio = speech(item.text, this.abort.signal).then((bytes) => {
          if (this.cancelled) throw new DOMException('Cancelado', 'AbortError');
          return this.context.decodeAudioData(bytes);
        });
        // La promesa se consume al llegar su turno; evita rechazos no manejados durante la espera.
        void item.audio.catch(() => undefined);
      }
    }
  }

  private async pump() {
    if (this.cancelled || this.paused || this.source || this.loading) return;
    const item = this.items[this.index];
    if (!item) { if (this.complete) this.events.onDone(); return; }
    this.loading = true;
    try {
      this.prefetch();
      this.buffer = await item.audio!;
      if (!this.cancelled && !this.paused) this.play();
    } catch (error) {
      if (!this.cancelled) { this.cancel(); this.events.onError(error); }
    } finally { this.loading = false; }
  }

  private play() {
    if (!this.buffer || this.cancelled || this.paused) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    this.source = source;
    this.startedAt = this.context.currentTime;
    source.onended = () => {
      source.disconnect();
      if (this.source !== source || this.cancelled) return;
      this.endPlayback?.(); this.endPlayback = undefined;
      this.heard.push(this.items[this.index]!.text);
      this.items[this.index]!.audio = undefined;
      this.index++;
      this.source = undefined; this.buffer = undefined; this.offset = 0;
      this.prefetch(); void this.pump();
    };
    source.start(0, this.offset);
    this.endPlayback = trackVoicePlayback();
    this.events.onStart();
  }

  finish() { this.complete = true; void this.pump(); }
  pause() {
    this.paused = true;
    if (this.source) {
      this.offset += this.context.currentTime - this.startedAt;
      this.stopSource();
    }
  }
  resume() {
    if (!this.paused || this.cancelled) return;
    this.paused = false;
    if (this.buffer) this.play(); else void this.pump();
  }
  private stopSource() {
    this.endPlayback?.(); this.endPlayback = undefined;
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop(); this.source.disconnect(); this.source = undefined;
  }
  cancel() {
    this.cancelled = true; this.abort.abort(); this.stopSource(); this.items = []; this.buffer = undefined;
  }
  // Conservador: una oración cortada a la mitad no se considera escuchada completa.
  playedText() { return this.heard.join(' '); }
}

/** Debe llamarse dentro del gesto de activación para desbloquear Safari/iOS. */
export function unlockAudio(): AudioContext {
  const context = new AudioContext();
  void context.resume();
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, 22050);
  source.connect(context.destination); source.start();
  source.onended = () => source.disconnect();
  return context;
}
