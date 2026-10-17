import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { VoiceProviderError, type VoiceService } from '@fablab/agent/voice';
import { handleError } from '../src/middleware/error';
import { createMemoryRateLimiter } from '../src/middleware/rate-limit';
import { createVoiceRoutes } from '../src/routes/voice';
import { validateAudio } from '../src/voice/validate';

function wav(seconds = 1) {
  const bytes = Buffer.alloc(44 + Math.round(seconds * 16000) * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
function setup() {
  const service: VoiceService = {
    transcribe: vi.fn(async () => '  Hola Fab Lab  '),
    synthesize: vi.fn(async () => ({
      stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }),
      contentType: 'audio/wav' as const,
    })),
  };
  const app = new Hono().route('/voice', createVoiceRoutes(createMemoryRateLimiter(), service));
  app.onError(handleError);
  const upload = (bytes = wav(), type = 'audio/wav') => {
    const form = new FormData(); form.append('audio', new File([Uint8Array.from(bytes)], 'turn.wav', { type }));
    return app.request('/voice/transcribe', { method: 'POST', body: form });
  };
  const speech = (text: unknown) => app.request('/voice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  return { service, app, upload, speech };
}

describe('validación del audio de voz', () => {
  it('acepta WAV PCM16 de hasta 60 segundos y calcula la duración de los bytes reales', () => {
    expect(validateAudio(wav(60), 'audio/wav')).toBe('wav');
    expect(() => validateAudio(wav(60.1), 'audio/wav')).toThrow(/60 segundos/);
    expect(() => validateAudio(wav(0.1), 'audio/wav')).toThrow(/400/);
    const fake = wav(); fake.writeUInt32LE(999, 40);
    expect(() => validateAudio(fake, 'audio/wav')).toThrow(/inválido/);
  });
  it('rechaza encabezados falsos, frecuencia, canales y tamaño incoherentes', () => {
    for (const offset of [0, 8, 20, 22, 24, 28, 32, 34]) {
      const bytes = wav(); bytes[offset] = bytes[offset]! ^ 1;
      expect(() => validateAudio(bytes, 'audio/wav')).toThrow();
    }
    expect(() => validateAudio(Buffer.alloc(3 * 1024 * 1024 + 1), 'audio/wav')).toThrow(/3 MB/);
    expect(() => validateAudio(wav(), 'audio/ogg')).toThrow();
  });
  it('valida cuadros MP3 y su duración en lugar de confiar en ID3', () => {
    const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0]); // MPEG1 Layer3, 128 kbps, 44.1 kHz.
    expect(validateAudio(Buffer.concat(Array(20).fill(frame)), 'audio/mpeg')).toBe('mp3');
    expect(() => validateAudio(Buffer.concat(Array(2400).fill(frame)), 'audio/mpeg')).toThrow(/60 segundos/);
    expect(() => validateAudio(Buffer.from('ID3not-an-mp3'), 'audio/mpeg')).toThrow();
    expect(() => validateAudio(frame.subarray(0, 200), 'audio/mpeg')).toThrow();
  });
});

describe('rutas públicas de voz con proveedor simulado', () => {
  it('transcribe en memoria y propaga el formato y la cancelación', async () => {
    const s = setup(); const res = await s.upload();
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ text: 'Hola Fab Lab' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(s.service.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), { format: 'wav', abortSignal: expect.any(AbortSignal) });
  });
  it('devuelve WAV sin caché y valida el texto antes de gastar', async () => {
    const s = setup(); const res = await s.speech(' Hola ');
    expect(res.status).toBe(200); expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    for (const text of ['', ' ', 'a'.repeat(501), 15]) expect((await s.speech(text)).status).toBe(400);
    expect(s.service.synthesize).toHaveBeenCalledOnce();
  });
  it('registra estado y motivo de OpenRouter sin exponer el texto ni su cuerpo de error', async () => {
    const s = setup();
    vi.stubEnv('LOG_LEVEL', 'error');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      vi.mocked(s.service.synthesize).mockRejectedValue(new VoiceProviderError(400, 'unsupported_audio_format', 'speech'));
      expect((await s.speech('Texto privado de la conversación')).status).toBe(502);
      const entry = log.mock.calls.map(([line]) => JSON.parse(line)).find((entry) => entry.event === 'voice.speech_failed');
      expect(entry).toMatchObject({ providerStatus: 400, reason: 'unsupported_audio_format' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('Texto privado');
    } finally { log.mockRestore(); vi.unstubAllEnvs(); }
  });
  it('rechaza audio falso, demasiado largo y demasiado grande antes de llamar al proveedor', async () => {
    const s = setup();
    expect((await s.upload(Buffer.from('not-a-wav'))).status).toBe(415);
    expect((await s.upload(wav(61))).status).toBe(413);
    expect((await s.upload(Buffer.alloc(3 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await s.upload(wav(), 'audio/ogg')).status).toBe(415);
    expect(s.service.transcribe).not.toHaveBeenCalled();
  });
  it('convierte fallos del proveedor a errores 502 sin exponer su contenido', async () => {
    const s = setup();
    vi.mocked(s.service.transcribe).mockRejectedValue(new Error('secret-provider-payload'));
    vi.mocked(s.service.synthesize).mockRejectedValue(new Error('secret-provider-payload'));
    for (const res of [await s.upload(), await s.speech('Hola')]) {
      expect(res.status).toBe(502);
      const body = await res.text(); expect(body).not.toContain('secret-provider'); expect(body).toContain('voice_unavailable');
    }
  });
  it('aplica límites independientes con Retry-After', async () => {
    const s = setup();
    for (let i = 0; i < 12; i++) expect((await s.upload()).status).toBe(200);
    const blocked = await s.upload();
    expect(blocked.status).toBe(429); expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) expect((await s.speech('Hola')).status).toBe(200);
    expect((await s.speech('Hola')).status).toBe(429);
  });
});
