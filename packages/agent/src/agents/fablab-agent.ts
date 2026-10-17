import { Agent } from '@mastra/core/agent';
import { getChatModels, getChatModelSettings } from '../models';
import { getContactInfo } from '../tools/get-contact-info';
import { getDocumentLink } from '../tools/get-document-link';
import { searchDocuments } from '../tools/search-documents';
import { buildInstructions } from './fablab-instructions';

/** Pasos máximos del agente por respuesta (spec §6). */
export const AGENT_MAX_STEPS = 5;

/**
 * Un solo agente, tres herramientas de solo lectura y una regla central: no afirmar nada que no
 * provenga de un fragmento recuperado. Sin `memory`: el hilo viene del cliente y la única fuente
 * de verdad del historial son `conversations` y `messages` (ver packages/server).
 */
export const fabLabAgent = new Agent({
  id: 'fabLabAgent',
  name: 'fabLabAgent',
  // Las instrucciones dependen del canal: `web` hoy, `voice` en la Fase 2.
  instructions: ({ requestContext }) => buildInstructions(requestContext?.get('channel') === 'voice' ? 'voice' : 'web'),
  // Funciones, no valores: `CHAT_MODELS` y los topes se leen al usarse y no al importar el módulo
  // (p. ej. durante `next build`). El modelo es una lista: el primero y sus respaldos.
  model: () => getChatModels(),
  tools: { searchDocuments, getDocumentLink, getContactInfo },
  defaultOptions: () => ({
    maxSteps: AGENT_MAX_STEPS,
    modelSettings: { ...getChatModelSettings() },
  }),
});
