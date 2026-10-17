import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceController, type VoiceDependencies } from './controller';
import type { VadCallbacks } from './vad';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const sample = new Float32Array(16000);

async function setup() {
  let vad!: VadCallbacks;
  let playerEvents!: Parameters<VoiceDependencies['player']>[0];
  let update!: Parameters<VoiceDependencies['runAgent']>[1];
  let signal!: AbortSignal;
  const response = deferred<void>();
  const player = { add: vi.fn(), finish: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), playedText: () => 'Lo que se escuchó.' };
  const destroy = vi.fn(async () => undefined);
  const setListening = vi.fn(async (_enabled: boolean) => undefined);
  const deps: VoiceDependencies = {
    detector: vi.fn(async (callbacks) => { vad = callbacks; return { destroy, setSpeaking: vi.fn(), setListening }; }),
    player: vi.fn((events) => { playerEvents = events; return player; }),
    transcribe: vi.fn(async () => '¿Qué servicios ofrecen?'),
    runAgent: vi.fn((_text, onText, abortSignal) => { update = onText; signal = abortSignal; return response.promise; }),
    interrupted: vi.fn(), metric: vi.fn(),
  };
  const controller = new VoiceController(deps);
  await controller.start();
  const utterance = async () => { vad.onSpeechStart(); vad.onSpeechConfirmed(); vad.onSpeechEnd(sample); await flush(); };
  return { controller, deps, vad, player, response, destroy, setListening, utterance, events: () => playerEvents, update: (text: string) => update('assistant-1', text), signal: () => signal };
}

afterEach(() => vi.useRealTimers());

describe('controlador de voz', () => {
  it('completa un turno y espera tanto el stream como el audio', async () => {
    const s = await setup();
    await s.utterance();
    expect(s.controller.getSnapshot().state).toBe('thinking');
    s.update('Esta es una respuesta suficientemente larga. ');
    s.events().onStart();
    expect(s.controller.getSnapshot().state).toBe('speaking');
    s.response.resolve(); await flush();
    expect(s.player.finish).toHaveBeenCalledOnce();
    expect(s.controller.getSnapshot().state).toBe('speaking');
    s.events().onDone();
    expect(s.controller.getSnapshot().state).toBe('listening');
    s.controller.stop();
  });
  it('una falsa alarma pausa y reanuda sin cancelar el agente', async () => {
    const s = await setup(); await s.utterance();
    s.events().onStart(); s.vad.onSpeechStart(); s.vad.onMisfire();
    expect(s.player.pause).toHaveBeenCalledOnce();
    expect(s.player.resume).toHaveBeenCalledOnce();
    expect(s.signal().aborted).toBe(false);
    s.controller.stop();
  });
  it('confirma la interrupción, conserva solo lo escuchado y descarta callbacks tardíos', async () => {
    const s = await setup(); await s.utterance();
    s.update('Esta es la respuesta que llegó a generarse. '); s.events().onStart();
    s.vad.onSpeechStart();
    expect(s.signal().aborted).toBe(false);
    s.vad.onSpeechConfirmed();
    expect(s.signal().aborted).toBe(true);
    expect(s.deps.interrupted).toHaveBeenCalledWith('assistant-1', 'Lo que se escuchó.');
    const count = s.player.add.mock.calls.length;
    s.update('Contenido tardío que nunca debe sonar. ');
    s.events().onStart(); s.events().onDone();
    s.response.resolve(); await flush();
    expect(s.player.add).toHaveBeenCalledTimes(count);
    expect(s.controller.getSnapshot().state).toBe('recording');
    s.controller.stop();
  });
  it('serializa frases recibidas mientras transcribe', async () => {
    const s = await setup();
    const transcription = deferred<string>();
    vi.mocked(s.deps.transcribe).mockReturnValueOnce(transcription.promise);
    await s.utterance(); await s.utterance();
    expect(s.deps.transcribe).toHaveBeenCalledOnce();
    transcription.resolve('Primera frase'); await flush();
    expect(s.deps.runAgent).toHaveBeenCalledOnce();
    s.response.resolve(); await flush(); s.events().onDone(); await flush();
    expect(s.deps.transcribe).toHaveBeenCalledTimes(2);
    s.controller.stop();
  });
  it('se recupera de STT y TTS caídos y mantiene el texto cuando falla la síntesis', async () => {
    const s = await setup();
    vi.mocked(s.deps.transcribe).mockRejectedValueOnce(new Error('STT caído'));
    await s.utterance();
    expect(s.controller.getSnapshot()).toMatchObject({ state: 'listening', error: 'STT caído' });
    await s.utterance();
    s.events().onError(new Error('TTS caído'));
    expect(s.signal().aborted).toBe(false);
    s.response.resolve(); await flush();
    expect(s.controller.getSnapshot()).toMatchObject({ state: 'listening', error: 'TTS caído' });
    await s.utterance();
    expect(s.deps.runAgent).toHaveBeenCalledTimes(2);
    s.controller.stop();
  });
  it('rechaza turnos cortos, libera el micrófono y se desactiva por inactividad', async () => {
    vi.useFakeTimers();
    const s = await setup();
    s.vad.onSpeechStart(); s.vad.onSpeechEnd(new Float32Array(1600));
    expect(s.deps.transcribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(s.controller.getSnapshot().state).toBe('idle');
    expect(s.destroy).toHaveBeenCalledOnce();
  });
  it('detener durante una transcripción descarta el resultado tardío', async () => {
    const s = await setup(); const transcription = deferred<string>();
    vi.mocked(s.deps.transcribe).mockReturnValueOnce(transcription.promise);
    await s.utterance(); s.controller.stop();
    transcription.resolve('Texto que llegó tarde'); await flush();
    expect(s.deps.runAgent).not.toHaveBeenCalled();
    expect(s.controller.getSnapshot().state).toBe('idle');
  });
  it('20 interrupciones seguidas no dejan callbacks de turnos anteriores activos', async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++) {
      await s.utterance(); s.update(`Respuesta suficientemente larga del turno ${i}. `);
      s.vad.onSpeechStart(); s.vad.onSpeechConfirmed();
      expect(s.signal().aborted).toBe(true);
      expect(s.controller.getSnapshot().state).toBe('recording');
      s.vad.onMisfire();
    }
    expect(s.deps.interrupted).toHaveBeenCalledTimes(20);
    s.controller.stop();
  });
  it('silenciar el micrófono conserva la respuesta y no permite capturar hasta reactivar', async () => {
    const s = await setup(); await s.utterance();
    s.controller.toggleMicrophone();
    expect(s.controller.getSnapshot().microphoneMuted).toBe(true);
    expect(s.setListening).toHaveBeenLastCalledWith(false);
    expect(s.player.pause).not.toHaveBeenCalled();
    expect(s.signal().aborted).toBe(false);
    await s.utterance();
    expect(s.deps.transcribe).toHaveBeenCalledOnce();
    s.controller.toggleMicrophone();
    expect(s.setListening).toHaveBeenLastCalledWith(true);
    s.controller.stop();
    expect(s.controller.getSnapshot()).toMatchObject({ state: 'idle', microphoneMuted: false });
  });
});
