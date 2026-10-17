import type { VoicePlayer } from './audio-queue';
import { SentenceBuffer } from './sentences';
import type { VoiceDetector, VadCallbacks } from './vad';

export type VoiceState = 'idle' | 'starting' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
export type VoiceSnapshot = { state: VoiceState; error: string | null; microphoneMuted: boolean };
export type VoiceMetric = { name: 'first_audio' | 'interruption' | 'turn_complete'; milliseconds: number };
type Turn = {
  id: number; abort: AbortController; player: VoicePlayer; sentences: SentenceBuffer;
  messageId?: string; text: string; streamDone: boolean; started: number; sounded: boolean; speechFailed: boolean;
};

export type VoiceDependencies = {
  detector(callbacks: VadCallbacks, signal: AbortSignal): Promise<VoiceDetector>;
  player(events: { onStart(): void; onDone(): void; onError(error: unknown): void }): VoicePlayer;
  transcribe(audio: Float32Array, signal: AbortSignal): Promise<string>;
  runAgent(text: string, update: (id: string, text: string) => void, signal: AbortSignal): Promise<void>;
  interrupted(id: string, heardText: string): void;
  metric?(metric: VoiceMetric): void;
};

const errorText = (error: unknown) => {
  if (error instanceof Error && error.name === 'NotAllowedError') return 'No se autorizó el micrófono. Habilita el permiso del sitio o sigue escribiendo.';
  if (error instanceof Error && error.name === 'NotFoundError') return 'No se encontró un micrófono. Puedes seguir escribiendo.';
  return error instanceof Error ? error.message : 'No se pudo usar la voz. Puedes seguir escribiendo.';
};

/** Un único turno vigente. Todos los callbacks comprueban su identidad antes de mutar el estado. */
export class VoiceController {
  private snapshot: VoiceSnapshot = { state: 'idle', error: null, microphoneMuted: false };
  private listeners = new Set<() => void>();
  private session?: AbortController;
  private detector?: VoiceDetector;
  private turn?: Turn;
  private sequence = 0;
  private pending: { audio: Float32Array; ended: number }[] = [];
  private transcribing = false;
  private candidate = false;
  private confirmed = false;
  private candidateAt = 0;
  private inactivity?: ReturnType<typeof setTimeout>;

  constructor(private deps: VoiceDependencies) {}
  getSnapshot = () => this.snapshot;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private set(state: VoiceState, error = this.snapshot.error) {
    this.snapshot = { ...this.snapshot, state, error };
    this.detector?.setSpeaking(state === 'speaking');
    this.listeners.forEach((callback) => callback());
  }

  async start() {
    if (this.session) return;
    const session = this.session = new AbortController();
    this.set('starting', null);
    try {
      const detector = await this.deps.detector({
        onSpeechStart: () => this.speechStart(),
        onSpeechConfirmed: () => this.speechConfirmed(),
        onMisfire: () => this.misfire(),
        onSpeechEnd: (audio) => this.speechEnd(audio),
        onLost: () => { this.stop(); this.set('idle', 'Se perdió el micrófono. Activa la voz de nuevo o sigue escribiendo.'); },
      }, session.signal);
      if (this.session !== session || session.signal.aborted) { await detector.destroy(); return; }
      this.detector = detector;
      this.set('listening'); this.touch();
    } catch (error) {
      if (this.session !== session) return;
      this.stop(); this.set('idle', errorText(error));
    }
  }

  private touch() {
    clearTimeout(this.inactivity);
    this.inactivity = setTimeout(() => {
      if (this.turn || this.transcribing || this.candidate) { this.touch(); return; }
      this.stop(); this.set('idle', 'La voz se desactivó tras tres minutos sin actividad.');
    }, 180_000);
  }

  private speechStart() {
    if (!this.session || this.candidate || this.snapshot.microphoneMuted) return;
    this.touch(); this.candidate = true; this.confirmed = false; this.candidateAt = performance.now();
    // Pausa inmediata (<300 ms); la confirmación del detector determina la cancelación.
    this.turn?.player.pause();
    if (this.snapshot.state === 'speaking') this.deps.metric?.({ name: 'interruption', milliseconds: performance.now() - this.candidateAt });
    if (!this.turn && !this.transcribing) this.set('recording', null);
  }
  private speechConfirmed() {
    if (!this.session || !this.candidate || this.snapshot.microphoneMuted) return;
    this.confirmed = true;
    if (this.turn && !this.transcribing) this.cancelTurn(true);
    if (!this.transcribing) this.set('recording', null);
  }
  private misfire() {
    if (!this.session || this.snapshot.microphoneMuted) return;
    this.candidate = false; this.confirmed = false;
    if (this.turn) this.turn.player.resume();
    else if (!this.transcribing) this.set('listening');
  }
  private speechEnd(audio: Float32Array) {
    if (!this.session || this.snapshot.microphoneMuted) return;
    if (audio.length < 6400) { this.misfire(); return; }
    if (!this.confirmed) this.speechConfirmed();
    if (this.turn && !this.transcribing) this.cancelTurn(true);
    this.candidate = false; this.confirmed = false;
    // Una segunda frase durante STT espera en memoria; nunca hay dos llamadas simultáneas a /chat.
    if (this.pending.length < 2) this.pending.push({ audio: audio.slice(0, 960000), ended: performance.now() });
    else this.set(this.snapshot.state, 'Hay varias frases pendientes. Espera un momento antes de continuar.');
    void this.drain();
  }

  private async drain() {
    const session = this.session;
    if (!session || this.transcribing || this.turn || !this.pending.length) return;
    const { audio, ended } = this.pending.shift()!;
    this.transcribing = true;
    const abort = new AbortController();
    const signal = AbortSignal.any([session.signal, abort.signal]);
    const id = ++this.sequence;
    this.set('transcribing', null);
    const started = ended;
    try {
      const text = await this.deps.transcribe(audio, signal);
      if (session !== this.session || id !== this.sequence) return;
      this.transcribing = false;
      if (!text) { this.set(this.candidate ? 'recording' : 'listening'); void this.drain(); return; }
      const turn: Turn = {
        id, abort, sentences: new SentenceBuffer(), text: '', streamDone: false, started, sounded: false, speechFailed: false,
        player: this.deps.player({
          onStart: () => {
            if (this.turn !== turn) return;
            if (!turn.sounded) { this.deps.metric?.({ name: 'first_audio', milliseconds: performance.now() - turn.started }); turn.sounded = true; }
            this.set('speaking');
          },
          onDone: () => { if (this.turn === turn && turn.streamDone) this.completeTurn(); },
          onError: (error) => {
            if (this.turn !== turn) return;
            turn.speechFailed = true;
            // El texto continúa llegando aunque falle TTS; el siguiente turno sigue disponible.
            this.set(this.candidate ? 'recording' : 'listening', errorText(error));
            if (turn.streamDone) this.completeTurn();
          },
        }),
      };
      this.turn = turn;
      this.set('thinking');
      if (this.candidate) turn.player.pause();
      await this.deps.runAgent(text, (messageId, response) => {
        if (this.turn !== turn || signal.aborted) return;
        turn.messageId = messageId; turn.text = response;
        for (const sentence of turn.sentences.take(response)) turn.player.add(sentence);
      }, signal);
      if (this.turn !== turn || signal.aborted) return;
      for (const sentence of turn.sentences.take(turn.text, true)) turn.player.add(sentence);
      turn.streamDone = true;
      if (turn.speechFailed) this.completeTurn(); else turn.player.finish();
    } catch (error) {
      if (session !== this.session || id !== this.sequence) return;
      this.turn?.player.cancel(); this.turn = undefined; this.transcribing = false;
      this.set(this.candidate ? 'recording' : 'listening', errorText(error));
      void this.drain();
    } finally {
      if (session === this.session && id === this.sequence) this.transcribing = false;
    }
  }

  private completeTurn() {
    this.deps.metric?.({ name: 'turn_complete', milliseconds: performance.now() - this.turn!.started });
    this.turn = undefined;
    this.set(this.candidate ? 'recording' : 'listening');
    void this.drain();
  }
  private cancelTurn(interrupted: boolean) {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined; ++this.sequence;
    // Captura lo escuchado antes de vaciar la cola.
    const heard = turn.player.playedText();
    turn.player.cancel(); turn.abort.abort();
    if (interrupted && turn.messageId) this.deps.interrupted(turn.messageId, heard);
  }
  stopResponse() {
    this.cancelTurn(true);
    if (this.session) { this.set(this.candidate ? 'recording' : 'listening'); void this.drain(); }
  }
  private syncMicrophone() {
    const session = this.session;
    void this.detector?.setListening(!this.snapshot.microphoneMuted).catch((error: unknown) => {
      if (this.session !== session) return;
      this.stop(); this.set('idle', errorText(error));
    });
  }
  toggleMicrophone() {
    if (!this.detector || !this.session) return;
    this.snapshot = { ...this.snapshot, microphoneMuted: !this.snapshot.microphoneMuted };
    this.candidate = false; this.confirmed = false;
    this.turn?.player.resume();
    this.syncMicrophone(); this.touch();
    this.set(this.turn || this.transcribing ? this.snapshot.state : 'listening');
  }
  stop() {
    const detector = this.detector;
    this.detector = undefined;
    this.cancelTurn(true);
    this.session?.abort(); this.session = undefined; ++this.sequence;
    clearTimeout(this.inactivity);
    this.pending = []; this.transcribing = false; this.candidate = false; this.confirmed = false;
    if (detector) void detector.destroy().catch(() => undefined);
    this.snapshot = { ...this.snapshot, microphoneMuted: false };
    this.set('idle', null);
  }
}
