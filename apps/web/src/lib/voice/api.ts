import { encodeWav } from './wav';

async function checked(response: Response) {
  if (response.ok) return response;
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After')) || 60;
    throw new Error(`Alcanzaste el límite de voz. Inténtalo en ${Math.ceil(seconds / 60)} minuto(s) o escribe tu mensaje.`);
  }
  const body = await response.json().catch(() => null);
  throw new Error(body?.error?.message ?? 'No se pudo usar la voz. Revisa tu conexión o escribe tu mensaje.');
}

export async function transcribe(samples: Float32Array, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append('audio', new File([encodeWav(samples)], 'turn.wav', { type: 'audio/wav' }));
  const response = await checked(await fetch('/api/voice/transcribe', { method: 'POST', body: form, signal }));
  const result = await response.json();
  if (typeof result.text !== 'string') throw new Error('No se pudo reconocer el audio. Inténtalo de nuevo.');
  if (result.text.length > 2000) throw new Error('La transcripción es demasiado larga. Intenta con una frase más corta.');
  return result.text.trim();
}

export async function speech(text: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await checked(await fetch('/api/voice/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal,
  }));
  return response.arrayBuffer();
}
