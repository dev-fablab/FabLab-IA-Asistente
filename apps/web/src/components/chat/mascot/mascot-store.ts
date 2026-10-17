import { useSyncExternalStore } from 'react';
import type { MascotMood } from './mood';

/**
 * Ánimo compartido entre la mascota del encabezado y la de la bienvenida. El encabezado queda fuera del
 * runtime del chat, así que el ánimo se publica aquí en lugar de pasarlo por props o contexto.
 */
let current: MascotMood = 'idle';
const listeners = new Set<() => void>();

export function setMascotMood(next: MascotMood) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useMascotMood = (): MascotMood => useSyncExternalStore(subscribe, () => current, () => 'idle');
