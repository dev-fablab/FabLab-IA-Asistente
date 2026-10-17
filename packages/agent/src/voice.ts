import { Readable } from 'node:stream';
import { CompositeVoice, MastraVoice } from '@mastra/core/voice';
import { z } from 'zod';
import { getVoiceEnv } from './env';
import { pcmToWav } from './voice-audio';

export type ListenOptions = { abortSignal?: AbortSignal; format: 'wav' | 'mp3' };
export type SpeakOptions = { abortSignal?: AbortSignal; speaker?: string };

/** Borde de audio reemplazable. No guarda audio ni incluye contenido en errores o registros. */
export interface VoiceService {
  transcribe(audio: Uint8Array, options: ListenOptions): Promise<string>;
  synthesize(text: string, options: SpeakOptions): Promise<SynthesizedAudio>;
}

export type SynthesizedAudio = { stream: ReadableStream<Uint8Array>; contentType: 'audio/wav' | 'audio/mpeg' };

/** Diagnóstico seguro: nunca conserva el cuerpo del proveedor, que puede repetir el texto enviado. */
export class VoiceProviderError extends Error {
  constructor(readonly statusCode: number, readonly reason: string, readonly endpoint: string) {
    super(`OpenRouter audio: HTTP ${statusCode} (${reason})`);
    this.name = 'VoiceProviderError';
  }
}

// Adaptador nativo: CompositeVoice instalado envuelve modelos AI SDK v5, mientras el proyecto
// utiliza v7. El proveedor propio también permite enviar explícitamente ZDR y formato/idioma.
class OpenRouterVoice extends MastraVoice<unknown, SpeakOptions, ListenOptions> {
  constructor() {
    super({ name: 'OpenRouterVoice' });
  }

  private async request(path: string, body: object, abortSignal?: AbortSignal) {
    const env = getVoiceEnv();
    const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(abortSignal ? [abortSignal] : [])]);
    const response = await fetch(`https://openrouter.ai/api/v1/audio/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, provider: { zdr: env.VOICE_ZDR, data_collection: 'deny' } }),
      signal,
    });
    if (!response.ok) {
      const body = z.object({ error: z.object({ message: z.string() }) }).safeParse(await response.json().catch(() => null));
      const message = body.success ? body.data.error.message : '';
      const reason = /response_format/i.test(message) ? 'unsupported_audio_format'
        : /voice/i.test(message) ? 'invalid_voice'
        : response.status === 429 ? 'rate_limited' : 'provider_rejected';
      throw new VoiceProviderError(response.status, reason, path);
    }
    return response;
  }

  async listen(audio: NodeJS.ReadableStream, options: ListenOptions) {
    const chunks: Buffer[] = [];
    for await (const chunk of audio) chunks.push(Buffer.from(chunk));
    const response = await this.request('transcriptions', {
      model: getVoiceEnv().STT_MODEL,
      input_audio: { data: Buffer.concat(chunks).toString('base64'), format: options.format },
      language: 'es',
    }, options.abortSignal);
    return z.object({ text: z.string() }).parse(await response.json()).text.trim();
  }

  async speak(input: string | NodeJS.ReadableStream, options: SpeakOptions = {}) {
    if (typeof input !== 'string') throw new Error('Se requiere texto para sintetizar');
    const env = getVoiceEnv();
    const response = await this.request('speech', {
      model: env.TTS_MODEL,
      input,
      voice: options.speaker ?? env.TTS_VOICE,
      response_format: env.TTS_RESPONSE_FORMAT,
      instructions: 'Habla en español de Chile, con tono cercano y claro, a velocidad natural.',
    }, options.abortSignal);
    if (!response.body || !response.headers.get('content-type')?.startsWith('audio/')) {
      await response.body?.cancel();
      throw new Error('OpenRouter no devolvió audio');
    }
    if (env.TTS_RESPONSE_FORMAT === 'pcm') {
      const mime = response.headers.get('content-type')!.split(';')[0]!.trim().toLowerCase();
      if (!['audio/pcm', 'audio/l16'].includes(mime)) {
        await response.body.cancel();
        throw new Error('El proveedor no devolvió el formato PCM solicitado');
      }
      // PCM crudo no contiene frecuencia ni duración: decodeAudioData necesita un contenedor WAV.
      const declaredRate = /(?:^|;)\s*rate\s*=\s*(\d+)/i.exec(response.headers.get('content-type')!);
      const sampleRate = declaredRate ? Number(declaredRate[1]) : env.TTS_SAMPLE_RATE;
      const channels = /(?:^|;)\s*channels\s*=\s*(\d+)/i.exec(response.headers.get('content-type')!);
      if (channels && Number(channels[1]) !== 1) {
        await response.body.cancel();
        throw new Error('El proveedor no devolvió audio mono');
      }
      const pcm = new Uint8Array(await response.arrayBuffer());
      return Readable.from([pcmToWav(pcm, sampleRate)]);
    }
    // Iteración explícita evita el desacuerdo de tipos BYOB entre DOM y node:stream/web.
    const reader = response.body.getReader();
    return Readable.from((async function* () {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    })());
  }

  override async getSpeakers() { return [{ voiceId: getVoiceEnv().TTS_VOICE }]; }
  override async getListener() { return { enabled: true }; }
}

const provider = new OpenRouterVoice();
const voice = new CompositeVoice({ input: provider, output: provider });

export const voiceService: VoiceService = {
  async transcribe(audio, options) {
    const text = await voice.listen(Readable.from([audio]), options);
    if (typeof text !== 'string') throw new Error('Respuesta de transcripción inválida');
    return text;
  },
  async synthesize(text, options) {
    const audio = await voice.speak(text, options);
    if (!(audio instanceof Readable)) throw new Error('Respuesta de síntesis inválida');
    return {
      stream: Readable.toWeb(audio) as ReadableStream<Uint8Array>,
      contentType: getVoiceEnv().TTS_RESPONSE_FORMAT === 'pcm' ? 'audio/wav' : 'audio/mpeg',
    };
  },
};
