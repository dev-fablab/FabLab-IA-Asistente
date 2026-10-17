import { describe, expect, it } from 'vitest';
import { cleanSpeechText, SentenceBuffer } from './sentences';
import { encodeWav } from './wav';

describe('WAV de voz', () => {
  it('codifica PCM16 mono a 16 kHz, recorta amplitud y no propaga NaN', () => {
    const wav = encodeWav(new Float32Array([-2, -1, 0, 1, 2, NaN]));
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767, 0]);
  });
});

describe('oraciones de un stream', () => {
  it('espera el contexto de decimales y abreviaturas y nunca duplica texto', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.take('El Dr. Pérez cobra 3.')).toEqual([]);
    expect(buffer.take('El Dr. Pérez cobra 3.5 pesos. La atención sigue.')).toEqual(['El Dr. Pérez cobra 3.5 pesos.']);
    expect(buffer.take('El Dr. Pérez cobra 3.5 pesos. La atención sigue.', true)).toEqual(['La atención sigue.']);
  });
  it('limpia enlaces sin leer URLs ni código, incluso con deltas dentro de un enlace', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.take('Puedes consultar [la guía](https://example.')).toEqual([]);
    expect(buffer.take('Puedes consultar [la guía](https://example.cl). Aquí está.', true))
      .toEqual(['Puedes consultar la guía.', 'Aquí está.']);
    expect(cleanSpeechText('# Hola **mundo**\n```ts\nsecret();\n```\n[guía](https://a.cl) correo@a.cl')).toBe('Hola mundo guía');
  });
  it('no lee código incompleto en streaming y limita cada solicitud a 500 caracteres', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.take('```ts\nconst respuesta = "Jamás decir esto.";\n')).toEqual([]);
    expect(buffer.take('```ts\nconst respuesta = "Jamás decir esto.";\n```\nEsta es la respuesta en pantalla.', true)).toEqual(['Esta es la respuesta en pantalla.']);
    const long = new SentenceBuffer().take('palabra '.repeat(300), true);
    expect(long.length).toBeGreaterThan(1);
    expect(long.every((s) => s.length <= 500)).toBe(true);
    expect(long.join(' ')).toBe('palabra '.repeat(300).trim());
  });
});
