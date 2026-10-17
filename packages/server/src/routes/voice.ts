import { voiceService, VoiceProviderError, type VoiceService } from '@fablab/agent/voice';
import { getVoiceEnv } from '@fablab/agent/env';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { ApiError, badRequest, errorBody } from '../errors';
import { rateLimit, type RateLimiter, type RateLimitRule } from '../middleware/rate-limit';
import { validate } from '../validation';
import { logger } from '../logger';
import { MAX_AUDIO_BYTES, validateAudio } from '../voice/validate';

export const TRANSCRIBE_RATE_LIMITS: RateLimitRule[] = [
  { limit: 12, windowMs: 300_000 }, { limit: 80, windowMs: 86_400_000 },
];
export const SPEECH_RATE_LIMITS: RateLimitRule[] = [
  { limit: 60, windowMs: 300_000 }, { limit: 400, windowMs: 86_400_000 },
];

function logVoiceFailure(operation: 'transcribe' | 'speech', error: unknown) {
  // Solo metadatos controlados: el error del proveedor puede incluir la transcripción o el texto.
  let config: Record<string, unknown> = {};
  try {
    const env = getVoiceEnv();
    config = { model: operation === 'speech' ? env.TTS_MODEL : env.STT_MODEL,
      ...(operation === 'speech' && { format: env.TTS_RESPONSE_FORMAT, voice: env.TTS_VOICE }) };
  } catch { /* La configuración inválida también termina en una respuesta pública genérica. */ }
  logger.error(`voice.${operation}_failed`, undefined, {
    ...config,
    ...(error instanceof VoiceProviderError
      ? { providerStatus: error.statusCode, reason: error.reason }
      : { reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'audio_request_failed' }),
  });
}

export function createVoiceRoutes(limiter: RateLimiter, service: VoiceService = voiceService) {
  return new Hono()
    .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); })
    .post('/transcribe', rateLimit(limiter, TRANSCRIBE_RATE_LIMITS, 'voice-transcribe'), bodyLimit({
      maxSize: MAX_AUDIO_BYTES + 16 * 1024, // Espacio para los encabezados multipart, además del archivo.
      onError: (c) => c.json(errorBody('payload_too_large', 'La grabación supera los 3 MB'), 413),
    }), async (c) => {
      let form: FormData;
      try { form = await c.req.formData(); } catch { throw badRequest('Envía el audio como multipart/form-data'); }
      const audio = form.get('audio');
      if (!(audio instanceof File)) throw badRequest('Falta el archivo de audio');
      if (audio.size > MAX_AUDIO_BYTES) throw new ApiError(413, 'payload_too_large', 'La grabación supera los 3 MB');
      const bytes = Buffer.from(await audio.arrayBuffer());
      const format = validateAudio(bytes, audio.type);
      try {
        const text = await service.transcribe(bytes, { format, abortSignal: c.req.raw.signal });
        return c.json({ text: text.trim() });
      } catch (error) {
        if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
        logVoiceFailure('transcribe', error);
        throw new ApiError(502, 'voice_unavailable', 'No se pudo transcribir el audio. Inténtalo de nuevo o escribe tu mensaje.');
      }
    })
    .post('/speech', rateLimit(limiter, SPEECH_RATE_LIMITS, 'voice-speech'), bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json(errorBody('payload_too_large', 'La solicitud es demasiado grande'), 413),
    }), validate('json', z.object({ text: z.string().trim().min(1).max(500) })), async (c) => {
      try {
        const audio = await service.synthesize(c.req.valid('json').text, { abortSignal: c.req.raw.signal });
        return new Response(audio.stream, { headers: { 'Content-Type': audio.contentType, 'Cache-Control': 'no-store' } });
      } catch (error) {
        if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
        logVoiceFailure('speech', error);
        throw new ApiError(502, 'voice_unavailable', 'No se pudo reproducir la respuesta. Puedes leerla en pantalla.');
      }
    });
}
