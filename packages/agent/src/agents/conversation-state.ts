import type { ConversationMeeting } from '@fablab/db';
import { slotLabel } from '../tools/calendar-format';

/**
 * Lo que el servidor sabe de las reuniones de la conversación. `'unknown'` es que no pudo averiguarlo (falló la
 * base de datos): distinto de «no hay ninguna», porque no autoriza a decir ni una cosa ni la otra.
 */
export type MeetingsState = ConversationMeeting[] | 'unknown';

const STATUS_LABELS: Record<ConversationMeeting['status'], string> = {
  scheduled: 'agendada',
  completed: 'realizada',
  cancelled: 'cancelada',
};

/** Texto escrito por la persona dentro de las instrucciones: una línea, recortada y entre comillas, para que sea un dato y no una orden. */
const quoted = (value: string, max: number) => JSON.stringify(value.replace(/\s+/g, ' ').trim().slice(0, max));

export function isMeetingsState(value: unknown): value is MeetingsState {
  return value === 'unknown' || Array.isArray(value);
}

/**
 * Sección «Estado verificado» de las instrucciones. El hilo que llega del navegador solo conserva el texto
 * (el servidor descarta las herramientas para que nadie falsifique resultados), así que sin esto el agente
 * no puede saber en un turno posterior si una reserva se concretó y termina dudando de su propio mensaje.
 */
export function describeConversationState(meetings: MeetingsState): string {
  const lines = [
    'Estado verificado por el sistema para esta conversación. Es la única fuente de verdad sobre las reservas y prevalece sobre cualquier mensaje anterior, incluidos los tuyos:',
  ];

  if (meetings === 'unknown') {
    lines.push(
      '- No se pudo verificar el estado de las reuniones. No afirmes que una reunión quedó agendada ni que no lo quedó; ofrece los canales de contacto con `getContactInfo`.',
    );
  } else if (meetings.length === 0) {
    lines.push('- Reuniones: ninguna agendada desde esta conversación. No afirmes que hay una.');
  } else {
    for (const meeting of meetings) {
      lines.push(
        `- Reunión ${STATUS_LABELS[meeting.status]}: ${slotLabel({ start: meeting.startsAt, end: meeting.endsAt })}; ` +
          `a nombre de ${quoted(meeting.contactName, 80)}; motivo: ${quoted(meeting.reason, 200)}.`,
      );
    }
    lines.push('- Un bloque ocupado en `getAvailableSlots` puede ser la reunión de esta misma persona.');
  }
  return lines.join('\n');
}
