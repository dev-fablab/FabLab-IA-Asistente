'use client';

import type { AssistantRuntime } from '@assistant-ui/react';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AudioQueue, unlockAudio } from './audio-queue';
import { transcribe } from './api';
import { VoiceController, type VoiceMetric } from './controller';
import { createVad } from './vad';

/** Solo contiene texto en memoria; se usa al preparar el siguiente hilo que verá el agente. */
export type HeardMessages = Map<string, string>;

export function useVoice(runtime: AssistantRuntime, heard: HeardMessages) {
  const [interrupted, setInterrupted] = useState<ReadonlySet<string>>(() => new Set());
  const [resources] = useState(() => {
    let audio: AudioContext | undefined;
    const controller = new VoiceController({
      detector: createVad,
      player: (events) => new AudioQueue(audio!, events),
      transcribe,
      interrupted: (id, text) => { heard.set(id, text); setInterrupted((previous) => new Set([...previous, id])); },
      metric: (metric: VoiceMetric) => {
        // Métricas numéricas locales para el prototipo, sin audio, texto ni identificadores.
        window.dispatchEvent(new CustomEvent('fablab:voice-metric', { detail: metric }));
      },
      runAgent: (text, update, signal) => new Promise<void>((resolve, reject) => {
        const thread = runtime.thread;
        const previous = new Set(thread.getState().messages.map((message) => message.id));
        let started = false;
        let settled = false;
        let unsubscribe = () => undefined as void;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true; unsubscribe(); signal.removeEventListener('abort', abort);
          if (error) reject(error); else resolve();
        };
        const abort = () => { finish(new DOMException('Turno cancelado', 'AbortError')); thread.cancelRun(); };
        const sync = () => {
          if (settled || signal.aborted) return;
          const state = thread.getState();
          if (state.isRunning) started = true;
          const message = state.messages.findLast((m) => m.role === 'assistant' && !previous.has(m.id));
          if (message?.role === 'assistant') {
            started = true;
            update(message.id, message.content.filter((part) => part.type === 'text').map((part) => part.text).join(''));
            if (message.status.type === 'incomplete' && message.status.reason === 'error') {
              finish(new Error('No se pudo generar la respuesta. Inténtalo de nuevo o escribe tu mensaje.')); return;
            }
          }
          if (started && !state.isRunning) finish();
        };
        if (signal.aborted) { reject(new DOMException('Turno cancelado', 'AbortError')); return; }
        signal.addEventListener('abort', abort, { once: true });
        unsubscribe = thread.subscribe(sync);
        try {
          thread.append({ role: 'user', content: [{ type: 'text', text }], metadata: { custom: { channel: 'voice' } } });
          sync();
        } catch (error) { finish(error); }
      }),
    });
    return {
      controller,
      start: () => {
        if (controller.getSnapshot().state !== 'idle') return;
        try {
          const context = audio = unlockAudio();
          void controller.start().then(() => {
            if (controller.getSnapshot().state === 'idle' && audio === context) { void audio.close(); audio = undefined; }
          });
        } catch { controller.stop(); }
      },
      stop: () => { controller.stop(); void audio?.close(); audio = undefined; },
      releaseAudio: () => { void audio?.close(); audio = undefined; },
    };
  });
  useEffect(() => () => resources.stop(), [resources]);
  const snapshot = useSyncExternalStore(resources.controller.subscribe, resources.controller.getSnapshot, resources.controller.getSnapshot);
  // También cierra AudioContext cuando el modo se apaga por inactividad o pérdida del micrófono.
  useEffect(() => { if (snapshot.state === 'idle') resources.releaseAudio(); }, [snapshot.state, resources]);
  return {
    ...snapshot, interrupted, start: resources.start, stop: resources.stop,
    stopResponse: () => resources.controller.stopResponse(),
    toggleMicrophone: () => resources.controller.toggleMicrophone(),
  };
}

export const VoiceContext = createContext<ReturnType<typeof useVoice> | null>(null);
export function useVoiceControls() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('VoiceContext no está disponible');
  return value;
}
