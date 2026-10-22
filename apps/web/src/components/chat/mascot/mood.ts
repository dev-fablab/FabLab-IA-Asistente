/**
 * Estados de ánimo de la mascota y cómo se deducen del turno de la conversación. Es lógica pura (sin React ni
 * el runtime del chat) para poder probarla: `use-mascot-mood.ts` la conecta con Assistant UI.
 */

export type MascotMood = 'sleeping' | 'idle' | 'listening' | 'thinking' | 'searching' | 'working' | 'happy' | 'confused' | 'sad';

/** En qué va el último turno de la conversación. */
export type Turn = 'none' | 'waiting' | 'searching' | 'writing' | 'answered' | 'no-info' | 'unavailable' | 'failed';

/** Lo mínimo de un mensaje de Assistant UI que se necesita; evita acoplarse a sus tipos completos. */
export type MessageLike = {
  role: string;
  status?: { type: string; reason?: string };
  content: ReadonlyArray<{ type: string; toolName?: string; text?: string; result?: unknown }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Resultado de la última búsqueda en documentos del mensaje, si la hubo. */
function lastSearchResult(message: MessageLike): Record<string, unknown> | undefined {
  const results = message.content.filter((part) => part.type === 'tool-call' && part.toolName === 'searchDocuments' && isRecord(part.result));
  return results.at(-1)?.result as Record<string, unknown> | undefined;
}

/**
 * Turno actual a partir del último mensaje del hilo. Un mensaje de la persona sin respuesta todavía es
 * «esperando» (solo si el runtime está corriendo; si no, la conversación está en reposo).
 */
export function turnOf(message: MessageLike | undefined, running: boolean): Turn {
  if (!message) return 'none';
  if (message.role !== 'assistant') return running ? 'waiting' : 'none';

  const status = message.status;
  if (status?.type === 'running') {
    // Las partes de herramienta no traen estado propio: una sin `result` todavía está corriendo.
    if (message.content.some((part) => part.type === 'tool-call' && part.result === undefined)) return 'searching';
    if (message.content.some((part) => part.type === 'text' && (part.text ?? '').length > 0)) return 'writing';
    return 'waiting';
  }
  if (status?.type === 'incomplete' && status.reason === 'error') return 'failed';

  // Un error técnico de la búsqueda no es lo mismo que no tener documentación (ver `detectNoAnswer` en el servidor).
  const search = lastSearchResult(message);
  if (search?.unavailable === true) return 'unavailable';
  if (search?.found === false) return 'no-info';
  return message.content.some((part) => part.type === 'text' && (part.text ?? '').length > 0) ? 'answered' : 'none';
}

/** Lo que se muestra junto a la mascota según la herramienta que está corriendo. */
const TOOL_LABELS: Record<string, string> = {
  searchDocuments: 'Revisando la documentación…',
  getDocumentLink: 'Buscando el documento…',
  getContactInfo: 'Consultando los canales de contacto…',
  getAvailableSlots: 'Revisando los horarios disponibles…',
  scheduleMeeting: 'Agendando la reunión…',
};

/** Texto del indicador mientras la respuesta está en curso: la herramienta que corre o «Escribiendo…». */
export function statusLabel(message: MessageLike | undefined): string {
  const running = message?.content.findLast((part) => part.type === 'tool-call' && part.result === undefined);
  return (running?.toolName && TOOL_LABELS[running.toolName]) || (running ? 'Consultando…' : 'Escribiendo…');
}

/** Ánimos de un turno en curso: el indicador de la respuesta los muestra, así que el encabezado se queda en calma. */
export const RUNNING_MOODS: ReadonlySet<MascotMood> = new Set(['thinking', 'searching', 'working']);

/** Ánimo mientras el turno sigue en curso, o de reposo si la persona está escribiendo. */
export function liveMood(turn: Turn, drafting: boolean): MascotMood {
  if (turn === 'waiting') return 'thinking';
  if (turn === 'searching') return 'searching';
  if (turn === 'writing') return 'working';
  return drafting ? 'listening' : 'idle';
}

/**
 * Reacción momentánea cuando el turno pasa a un resultado. Se reacciona al cambio y no a «venía en curso»:
 * una respuesta casi instantánea (un error o un límite de tasa) puede llegar sin que se renderice la espera.
 * Cargar un historial ya respondido no cuenta, porque el turno inicial se toma como punto de partida.
 */
export function outcomeMood(previous: Turn, current: Turn): MascotMood | null {
  if (previous === current) return null;
  switch (current) {
    case 'answered':
      return 'happy';
    case 'no-info':
      return 'confused';
    case 'unavailable':
    case 'failed':
      return 'sad';
    default:
      return null; // En curso, o 'none' (la persona detuvo la respuesta).
  }
}

/** Animación del avatar para cada ánimo (claves de `strobi.avatar.json`). */
export const MOOD_ANIMATION = {
  sleeping: 'sleeping',
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  searching: 'searching',
  // Una animación amable: con las de «working» (ceño fruncido) el indicador de «Escribiendo…» se vería enojado.
  working: 'playful',
  happy: 'happy',
  confused: 'confused',
  sad: 'sad',
} as const satisfies Record<MascotMood, string>;

/** Con «reducir movimiento» no se encadenan expresiones: queda una fija por ánimo. */
export const MOOD_EXPRESSION = {
  sleeping: 'eyes-closed',
  idle: 'neutral',
  listening: 'attentive-left',
  thinking: 'curious-left',
  searching: 'far-right-glance',
  working: 'playful-right',
  happy: 'joyful-wide',
  confused: 'skeptical-left',
  sad: 'sleepy-squint',
} as const satisfies Record<MascotMood, string>;
