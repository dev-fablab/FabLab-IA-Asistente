'use client';

import { createAvatar } from '@bible-strong/avatar-react';
import '@bible-strong/avatar-react/styles.css';
import { useSyncExternalStore } from 'react';
import { useMascotMood } from './mascot-store';
import { MOOD_ANIMATION, MOOD_EXPRESSION, RUNNING_MOODS, type MascotMood } from './mood';
import strobi from './strobi.avatar.json';

// `createAvatar` valida el JSON una sola vez y tipa las claves de animación y de expresión.
// Conserva cada secuencia y sus expresiones; durante TTS solo acelera sus tiempos.
type AnimationName = keyof typeof strobi.animations;
const speechAnimations = Object.fromEntries(Object.entries(strobi.animations).map(([name, timeline]) => [
  `${name}-speaking`,
  { ...timeline, steps: timeline.steps.map((step) => ({
    ...step,
    holdMs: Math.round(step.holdMs / 2.2),
    transitionMs: Math.max(160, Math.round(step.transitionMs / 1.8)),
  })) },
])) as { [K in AnimationName as `${K}-speaking`]: (typeof strobi.animations)[K] };
const Strobi = createAvatar({
  ...strobi,
  animations: { ...strobi.animations, ...speechAnimations },
  animationOrder: [...strobi.animationOrder, ...strobi.animationOrder.map((name) => `${name}-speaking`)],
});

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
export function Mascot({ size = 44, className, calm = false, speaking = false, mood: overrideMood }: {
  size?: number | string; className?: string; calm?: boolean; speaking?: boolean; mood?: MascotMood;
}) {
  const current = useMascotMood();
  // `calm`: mientras la respuesta está en curso, otra mascota (la del indicador) es la que reacciona.
  const mood = overrideMood ?? (calm && RUNNING_MOODS.has(current) ? 'idle' : current);
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);

  return (
    <div aria-hidden className={className} data-mood={mood}>
      {reduced ? (
        <Strobi size={size} expression={MOOD_EXPRESSION[mood]} />
      ) : (
        <Strobi size={size} animation={speaking ? `${MOOD_ANIMATION[mood]}-speaking` : MOOD_ANIMATION[mood]} />
      )}
    </div>
  );
}
