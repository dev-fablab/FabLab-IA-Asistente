'use client';

import { createAvatar } from '@bible-strong/avatar-react';
import '@bible-strong/avatar-react/styles.css';
import { useSyncExternalStore } from 'react';
import { useMascotMood } from './mascot-store';
import { MOOD_ANIMATION, MOOD_EXPRESSION, RUNNING_MOODS } from './mood';
import strobi from './strobi.avatar.json';

// `createAvatar` valida el JSON una sola vez y tipa las claves de animación y de expresión.
const Strobi = createAvatar(strobi);

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;

/**
 * Strobi, la mascota de Fab Lab. Su expresión sigue el estado del chat (ver `use-report-mascot-mood.ts`). Es
 * decorativa: el estado ya se comunica con texto en el chat, así que se oculta a los lectores de pantalla.
 */
export function Mascot({ size = 44, className, calm = false }: { size?: number; className?: string; calm?: boolean }) {
  const current = useMascotMood();
  // `calm`: mientras la respuesta está en curso, otra mascota (la del indicador) es la que reacciona.
  const mood = calm && RUNNING_MOODS.has(current) ? 'idle' : current;
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);

  return (
    <div aria-hidden className={className} data-mood={mood}>
      {reduced ? (
        <Strobi size={size} expression={MOOD_EXPRESSION[mood]} />
      ) : (
        <Strobi size={size} animation={MOOD_ANIMATION[mood]} />
      )}
    </div>
  );
}
