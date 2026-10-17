/** Silero entrega PCM mono a 16 kHz; el formato es idéntico en todos los navegadores. */
export function encodeWav(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}
