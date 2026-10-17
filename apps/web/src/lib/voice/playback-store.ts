import { useSyncExternalStore } from 'react';

// La animación sigue el sonido real y se detiene al pausar o interrumpir la respuesta.
const playing = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function trackVoicePlayback(): () => void {
  const token = Symbol();
  playing.add(token);
  notify();
  return () => { if (playing.delete(token)) notify(); };
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useVoicePlayback = () => useSyncExternalStore(subscribe, () => playing.size > 0, () => false);
