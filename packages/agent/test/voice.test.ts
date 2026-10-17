import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voiceService } from '../src/voice';
import { pcmToWav } from '../src/voice-audio';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-voice-key');
  vi.stubEnv('STT_MODEL', 'nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b');
  vi.stubEnv('TTS_MODEL', 'google/gemini-3.8-flash-lite-tts');
  vi.stubEnv('TTS_VOICE', 'Kore'); vi.stubEnv('VOICE_ZDR', 'true');
  vi.stubEnv('TTS_RESPONSE_FORMAT', 'pcm'); vi.stubEnv('TTS_SAMPLE_RATE', '24000');
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('CompositeVoice con OpenRouter', () => {
  it('envía base64, español y política de datos al modelo de transcripción elegido', async () => {
    fetchMock.mockResolvedValue(Response.json({ text: ' Hola ' }));
    const abort = new AbortController();
    expect(await voiceService.transcribe(new Uint8Array([1, 2, 3]), { format: 'wav', abortSignal: abort.signal })).toBe('Hola');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect(JSON.parse(init.body)).toEqual({
      model: 'nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b',
      input_audio: { data: 'AQID', format: 'wav' }, language: 'es', provider: { zdr: true, data_collection: 'deny' },
    });
    abort.abort(); expect(init.signal.aborted).toBe(true);
  });
  it('solicita PCM a Gemini con voz Kore y devuelve WAV reproducible a 24 kHz', async () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValue(new Response(pcm, { headers: { 'Content-Type': 'audio/pcm' } }));
    const audio = await voiceService.synthesize('Hola Fab Lab', {});
    expect(audio.contentType).toBe('audio/wav');
    const wav = Buffer.from(await new Response(audio.stream).arrayBuffer());
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(28)).toBe(48000);
    expect(wav.subarray(44)).toEqual(Buffer.from(pcm));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ model: 'google/gemini-3.8-flash-lite-tts', input: 'Hola Fab Lab', response_format: 'pcm', voice: 'Kore' });
    expect(body.instructions).toContain('Chile');
  });
  it('mantiene MP3 configurable para modelos que sí lo admiten', async () => {
    vi.stubEnv('TTS_RESPONSE_FORMAT', 'mp3');
    const bytes = new Uint8Array([1, 2, 3]);
    fetchMock.mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } }));
    const audio = await voiceService.synthesize('Hola Fab Lab', {});
    expect(audio.contentType).toBe('audio/mpeg');
    expect(new Uint8Array(await new Response(audio.stream).arrayBuffer())).toEqual(bytes);
  });
  it('respeta la frecuencia declarada en PCM y rechaza canales o formatos incompatibles', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0, 1]), { headers: { 'Content-Type': 'audio/pcm;rate=16000;channels=1' } }));
    const audio = await voiceService.synthesize('Hola', {});
    expect(Buffer.from(await new Response(audio.stream).arrayBuffer()).readUInt32LE(24)).toBe(16000);
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0, 1]), { headers: { 'Content-Type': 'audio/pcm;rate=24000;channels=2' } }));
    await expect(voiceService.synthesize('Hola', {})).rejects.toThrow('mono');
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0, 1]), { headers: { 'Content-Type': 'audio/mpeg' } }));
    await expect(voiceService.synthesize('Hola', {})).rejects.toThrow('PCM solicitado');
  });
  it('clasifica el rechazo de formato sin conservar texto ni claves en el error', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'Gemini TTS only supports response_format="pcm". Got "mp3". Texto privado', code: 400 } }, { status: 400 }));
    await expect(voiceService.synthesize('Texto privado', {})).rejects.toMatchObject({ statusCode: 400, reason: 'unsupported_audio_format' });
    await expect(voiceService.synthesize('Texto privado', {})).rejects.not.toThrow('Texto privado');
  });
  it('no expone errores del proveedor ni interpreta JSON como audio', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'sensitive-content' } }, { status: 403 }));
    await expect(voiceService.synthesize('Hola', {})).rejects.toThrow('HTTP 403');
    fetchMock.mockResolvedValue(Response.json({ text: 'not-audio' }));
    await expect(voiceService.synthesize('Hola', {})).rejects.toThrow('no devolvió audio');
  });
});

describe('contenedor WAV para PCM de síntesis', () => {
  it('conserva las muestras y escribe el tamaño correcto de todos los bloques', () => {
    const pcm = new Uint8Array([0, 128, 255, 127]);
    const wav = pcmToWav(pcm, 24000);
    expect(wav.length).toBe(48);
    expect(wav.readUInt32LE(4)).toBe(40);
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(44)).toEqual(Buffer.from(pcm));
  });
  it('rechaza PCM vacío o con una muestra incompleta', () => {
    expect(() => pcmToWav(new Uint8Array(0), 24000)).toThrow(/vacío/);
    expect(() => pcmToWav(new Uint8Array(3), 24000)).toThrow(/incompleto/);
  });
});
