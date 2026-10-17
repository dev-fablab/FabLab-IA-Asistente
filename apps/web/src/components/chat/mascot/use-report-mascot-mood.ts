'use client';

import { useAuiState } from '@assistant-ui/react';
import { useEffect, useState } from 'react';
import { setMascotMood } from './mascot-store';
import { liveMood, outcomeMood, turnOf, type MascotMood, type MessageLike, type Turn } from './mood';

/** Cuánto dura la reacción al terminar una respuesta (alegría, confusión o tristeza). */
const OUTCOME_MS = 5000;
/** Sin actividad durante este tiempo, la mascota se duerme; escribir o preguntar la despierta. */
const SLEEP_AFTER_MS = 60_000;

/**
 * Deduce el ánimo de la mascota del estado del chat y lo publica en el almacén compartido. Se usa una vez,
 * dentro del runtime de Assistant UI (`ChatSession`).
 */
export function useReportMascotMood() {
  // Selectores que devuelven valores simples: así solo se renderiza cuando algo cambia de verdad.
  const turn = useAuiState((s) => turnOf(s.thread.messages.at(-1) as MessageLike | undefined, s.thread.isRunning)) as Turn;
  const drafting = useAuiState((s) => s.composer.text.trim().length > 0);

  // Reacción al terminar un turno. Se detecta durante el render (patrón «ajustar estado al cambiar una
  // prop»): al cargar un historial ya respondido no hay un turno previo en curso y no se celebra nada.
  const [previousTurn, setPreviousTurn] = useState<Turn>(turn);
  const [outcome, setOutcome] = useState<{ mood: MascotMood; id: number } | null>(null);
  if (turn !== previousTurn) {
    setPreviousTurn(turn);
    const reaction = outcomeMood(previousTurn, turn);
    setOutcome(reaction ? { mood: reaction, id: (outcome?.id ?? 0) + 1 } : null);
  }

  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(() => setOutcome(null), OUTCOME_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  const live = liveMood(turn, drafting);
  const base = outcome && live === 'idle' ? outcome.mood : live;

  // Se duerme tras un rato en reposo. `asleepSince` guarda el ánimo con el que empezó la espera y se
  // descarta cuando el ánimo cambia (durante el render, igual que arriba).
  const [asleep, setAsleep] = useState(false);
  const [lastBase, setLastBase] = useState(base);
  if (base !== lastBase) {
    setLastBase(base);
    setAsleep(false);
  }

  useEffect(() => {
    if (base !== 'idle') return;
    const timer = setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [base]);

  const mood: MascotMood = asleep && base === 'idle' ? 'sleeping' : base;

  useEffect(() => {
    setMascotMood(mood);
  }, [mood]);

  // Al cerrar la conversación (o abrir otra) la mascota vuelve a reposo.
  useEffect(() => () => setMascotMood('idle'), []);
}
