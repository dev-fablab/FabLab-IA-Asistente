import { ensureMastraReady, getMastra } from '@fablab/agent';
import { getChatEnv, getEmbeddingEnv } from '@fablab/agent/env';
import { listActiveContactChannels, listConversationMeetings } from '@fablab/db';
import { handleChatStream } from '@mastra/ai-sdk';
import { RequestContext } from '@mastra/core/request-context';
import { createUIMessageStreamResponse } from 'ai';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { createChunkLogger, summarizeFinish, summarizeStep } from '../chat/log';
import { detectNoAnswer, textOfSteps, type AgentStepLike } from '../chat/no-answer';
import { chatBodySchema, lastUserText, sanitizeThread } from '../chat/thread';
import { ApiError, errorBody } from '../errors';
import { getConversationMessages, saveAssistantMessage, saveUserMessage } from '../history';
import { logger } from '../logger';
import {
  CHAT_RATE_LIMITS,
  rateLimit,
  type RateLimiter,
  type RateLimitRule,
} from '../middleware/rate-limit';
import { validate } from '../validation';

const MAX_BODY_BYTES = 1024 * 1024;

/** Lecturas públicas (retomar la conversación, canales de contacto): más holgado que el chat. */
const READ_RATE_LIMITS: RateLimitRule[] = [{ limit: 60, windowMs: 5 * 60 * 1000 }];

/** Lo único que ve la persona si falla el modelo; el detalle va al registro. */
const STREAM_ERROR_MESSAGE =
  'No se pudo generar la respuesta en este momento. Puedes reintentar o escribirle al equipo de Fab Lab.';

export type ChatRoutesOptions = {
  limiter: RateLimiter;
};

/**
 * Chat público (anónimo): límite de tasa, validación, persistencia del historial y la respuesta
 * del agente en streaming. Todas las herramientas del agente son de solo lectura salvo `scheduleMeeting`,
 * que crea una reunión: la valida y la acota la propia herramienta (horario, topes), no el chat.
 */
export function createChatRoutes({ limiter }: ChatRoutesOptions) {
  return new Hono()
    .post(
      '/',
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: (c) => c.json(errorBody('payload_too_large', 'La solicitud es demasiado grande'), 413),
      }),
      rateLimit(limiter, CHAT_RATE_LIMITS, 'chat'),
      validate('json', chatBodySchema),
      async (c) => {
        const body = c.req.valid('json');
        const thread = sanitizeThread(body.messages);
        const channel = body.channel ?? 'web';
        const modality = channel === 'voice' ? 'voice' : 'text';
        const requestContext = new RequestContext();
        requestContext.set('channel', channel);
        // Las herramientas de agenda ligan la reunión a esta conversación; el modelo no lo elige.
        requestContext.set('conversationId', body.id);

        // Registra con la conversación y la petición (`child` conserva el `requestId` aunque los callbacks
        // del stream corran después de responder). Solo cantidades: nunca el texto de la persona.
        const log = logger.child({ conversationId: body.id });
        const started = performance.now();
        const elapsed = () => Math.round(performance.now() - started);
        log.info('chat.received', {
          trigger: body.trigger ?? 'submit-message',
          clientMessages: body.messages.length,
          threadMessages: thread.length,
          userChars: lastUserText(thread).length,
        });

        // Sin modelo o sin storage de Mastra no se puede responder: falla antes de guardar o gastar nada.
        // `ensureMastraReady` crea las tablas de Mastra la primera vez que corre la instancia.
        try {
          getChatEnv();
          getEmbeddingEnv();
          await ensureMastraReady();
        } catch (error) {
          log.error('chat.not_configured', error);
          throw new ApiError(500, 'internal_error', 'El asistente no está disponible por el momento');
        }

        await saveUserMessage(body.id, lastUserText(thread), {
          regenerate: body.trigger === 'regenerate-message',
          channel,
          modality,
        });

        // El hilo del navegador solo conserva el texto: los resultados de las herramientas se descartan (ver
        // `sanitizeThread`). Sin esto el agente no sabría en el turno siguiente si una reserva se concretó, así que
        // el estado de las reuniones sale de la base de datos y se le entrega en las instrucciones.
        try {
          requestContext.set('conversationMeetings', await listConversationMeetings(body.id));
        } catch (error) {
          // Sin el estado el agente no debe afirmar ni negar una reserva; el chat sigue funcionando.
          log.error('chat.meetings_state_failed', error);
          requestContext.set('conversationMeetings', 'unknown');
        }

        // `onFinish` y `onAbort` (la persona detuvo la respuesta) guardan lo mismo: una sola vez.
        let persisted = false;
        const persistAssistant = async (event: { steps: readonly AgentStepLike[]; text?: string }) => {
          if (persisted) return;
          persisted = true;
          const content = textOfSteps(event.steps, event.text);
          if (!content) return;
          try {
            await saveAssistantMessage(body.id, { content, noAnswer: detectNoAnswer(event.steps), modality });
          } catch (error) {
            // La respuesta ya se entregó: un fallo al guardarla solo se registra.
            log.error('chat.persist_failed', error);
          }
        };

        const outcome = (event: { steps: readonly AgentStepLike[]; text?: string }) => ({
          textChars: textOfSteps(event.steps, event.text).length,
          noAnswer: detectNoAnswer(event.steps),
        });

        const stream = await handleChatStream({
          mastra: getMastra(),
          agentId: 'fabLabAgent',
          version: 'v7',
          // Solo valores controlados por el servidor: nunca se vuelca el cuerpo del cliente en
          // `params`, que acepta opciones de ejecución del agente.
          params: { messages: thread, ...(body.trigger && { trigger: body.trigger }) },
          defaultOptions: {
            requestContext,
            abortSignal: c.req.raw.signal,
            onChunk: createChunkLogger(log, elapsed),
            // Un paso por llamada al modelo: cuál respondió, tokens y qué herramientas usó (máximo 5 por turno).
            onStepFinish: (step) => log.info('chat.step', { ...summarizeStep(step), ms: elapsed() }),
            onFinish: async (event) => {
              const fields = { ...summarizeFinish(event), ...outcome(event), ms: elapsed() };
              if (event.error) log.error('chat.finished', event.error, fields);
              else log.info('chat.finished', fields);
              await persistAssistant(event);
            },
            onAbort: async (event) => {
              log.warn('chat.aborted', { steps: event.steps.length, ...outcome(event), ms: elapsed() });
              await persistAssistant(event);
            },
          },
          onError: (error) => {
            log.error('chat.stream_failed', error, { ms: elapsed() });
            return STREAM_ERROR_MESSAGE;
          },
        });

        return createUIMessageStreamResponse({ stream });
      },
    )

    .get(
      '/history',
      rateLimit(limiter, READ_RATE_LIMITS, 'chat-read'),
      validate('query', z.object({ conversationId: z.uuid() })),
      async (c) => {
        const messages = await getConversationMessages(c.req.valid('query').conversationId);
        c.header('Cache-Control', 'private, no-store');
        return c.json({ messages });
      },
    )

    // Canales activos: el chat los muestra si el modelo falla, igual que los daría el agente.
    .get('/contact', rateLimit(limiter, READ_RATE_LIMITS, 'chat-read'), async (c) =>
      c.json({ channels: await listActiveContactChannels() }),
    );
}
