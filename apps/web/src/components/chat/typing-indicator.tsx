'use client';

import { useAuiState } from '@assistant-ui/react';
import { Mascot } from './mascot/mascot';
import { statusLabel, type MessageLike } from './mascot/mood';

/**
 * Indicador de que el asistente está respondiendo: la mascota, que cambia de expresión según la etapa, y a su
 * lado qué está haciendo («Escribiendo…», «Revisando la documentación…»). Va al final de la respuesta en curso.
 */
export function TypingIndicator() {
  const label = useAuiState((s) => statusLabel(s.message as MessageLike));

  return (
    <div role="status" className="flex items-center gap-3 py-1">
      <Mascot size={44} className="shrink-0" />
      <span className="text-base font-medium text-foreground/80">{label}</span>
    </div>
  );
}
