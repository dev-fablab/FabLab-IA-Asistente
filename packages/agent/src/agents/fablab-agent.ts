import { Agent } from '@mastra/core/agent';
import { getChatModels, getChatModelSettings } from '../models';
import { getContactInfo } from '../tools/get-contact-info';
import { getAvailableSlots } from '../tools/get-available-slots';
import { getDocumentLink } from '../tools/get-document-link';
import { scheduleMeeting } from '../tools/schedule-meeting';
import { searchDocuments } from '../tools/search-documents';
import { isMeetingsState } from './conversation-state';
import { buildInstructions } from './fablab-instructions';

/** Pasos máximos del agente por respuesta (spec §6). */
export const AGENT_MAX_STEPS = 5;

/**
 * Un solo agente, cuatro herramientas de lectura y una de escritura (`scheduleMeeting`), y una regla
 * central: no afirmar nada que no provenga de un fragmento recuperado ni de la agenda. Sin `memory`: el hilo viene del cliente y la única fuente
 * de verdad del historial son `conversations` y `messages` (ver packages/server).
 */
export const fabLabAgent = new Agent({
  id: 'fabLabAgent',
  name: 'fabLabAgent',
  // Las instrucciones dependen del canal: `web` hoy, `voice` en la Fase 2.
  instructions: ({ requestContext }) => {
    const meetings: unknown = requestContext?.get('conversationMeetings');
    return buildInstructions(requestContext?.get('channel') === 'voice' ? 'voice' : 'web', isMeetingsState(meetings) ? meetings : undefined);
  },
  // Funciones, no valores: `CHAT_MODELS` y los topes se leen al usarse y no al importar el módulo
  // (p. ej. durante `next build`). El modelo es una lista: el primero y sus respaldos.
  model: () => getChatModels(),
  tools: { searchDocuments, getDocumentLink, getContactInfo, getAvailableSlots, scheduleMeeting },
  defaultOptions: () => ({
    maxSteps: AGENT_MAX_STEPS,
    modelSettings: { ...getChatModelSettings() },
  }),
});
