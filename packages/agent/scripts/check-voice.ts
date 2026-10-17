/** Prueba breve contra OpenRouter: solo imprime formato, tamaños y tiempo; nunca texto ni audio. */
import { getVoiceEnv } from '../src/env';
import { voiceService, VoiceProviderError } from '../src/voice';

async function main() {
  const env = getVoiceEnv();
  const started = performance.now();
  const audio = await voiceService.synthesize('Hola, soy el asistente de Fab Lab.', {});
  const bytes = Buffer.from(await new Response(audio.stream).arrayBuffer());
  if (audio.contentType === 'audio/wav' && (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')) {
    throw new Error('El audio no tiene un encabezado WAV válido');
  }
  console.log(JSON.stringify({
    model: env.TTS_MODEL,
    contentType: audio.contentType,
    bytes: bytes.length,
    ...(audio.contentType === 'audio/wav' && { sampleRate: bytes.readUInt32LE(24), channels: bytes.readUInt16LE(22) }),
    ms: Math.round(performance.now() - started),
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof VoiceProviderError
    ? JSON.stringify({ status: error.statusCode, reason: error.reason })
    : 'Falló la prueba de voz. Revisa las variables de entorno y la conexión con OpenRouter.');
  process.exitCode = 1;
});
