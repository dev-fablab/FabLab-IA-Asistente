/** PCM signed little-endian, mono, 16 bits. Solo agrega cabecera; no recodifica ni guarda audio. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) throw new Error('Frecuencia de audio no admitida');
  if (!pcm.byteLength || pcm.byteLength % 2 !== 0) throw new Error('El proveedor devolvió PCM16 vacío o incompleto');
  const wav = Buffer.alloc(44 + pcm.byteLength);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.byteLength - 8, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.byteLength, 40);
  wav.set(pcm, 44);
  return wav;
}
