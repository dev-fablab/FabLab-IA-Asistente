import { ApiError, badRequest } from '../errors';

export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const unsupported = () => new ApiError(415, 'unsupported_media_type', 'Formato de audio no admitido o archivo inválido');

function wavDuration(bytes: Buffer): number {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw unsupported();
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw unsupported();
  let rate = 0;
  let dataSize = 0;
  let formats = 0;
  let dataChunks = 0;
  let offset = 12;
  for (; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) throw unsupported();
    if (name === 'fmt ') {
      if (++formats > 1 || size < 16 || bytes.readUInt16LE(start) !== 1 ||
        bytes.readUInt16LE(start + 2) !== 1 || bytes.readUInt32LE(start + 4) !== 16000 ||
        bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt16LE(start + 14) !== 16) throw unsupported();
      rate = bytes.readUInt32LE(start + 8);
      if (rate !== 32000) throw unsupported();
    }
    if (name === 'data') {
      if (++dataChunks > 1 || size % 2 !== 0) throw unsupported();
      dataSize = size;
    }
    offset = start + size + (size % 2);
  }
  if (offset !== bytes.length || !rate || !dataSize) throw unsupported();
  return dataSize / rate;
}

/** Duración por cuadros MPEG Layer III; no confía en ID3, extensión ni bitrate declarado por el cliente. */
function mp3Duration(bytes: Buffer): number {
  let offset = 0;
  if (bytes.toString('ascii', 0, 3) === 'ID3') {
    if (bytes.length < 10 || (bytes[5]! & 0x10) || bytes.subarray(6, 10).some((n) => n > 127)) throw unsupported();
    offset = 10 + (bytes[6]! << 21) + (bytes[7]! << 14) + (bytes[8]! << 7) + bytes[9]!;
  }
  let seconds = 0;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes.length - offset === 128 && bytes.toString('ascii', offset, offset + 3) === 'TAG') { offset += 128; break; }
    const header = bytes.readUInt32BE(offset);
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const sampleIndex = (header >>> 10) & 3;
    if ((header >>> 21) !== 0x7ff || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) throw unsupported();
    const bitrates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sampleRate = [44100, 48000, 32000][sampleIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const size = Math.floor((version === 3 ? 144 : 72) * bitrates[bitrateIndex]! * 1000 / sampleRate) + ((header >>> 9) & 1);
    if (offset + size > bytes.length) throw unsupported();
    seconds += (version === 3 ? 1152 : 576) / sampleRate;
    offset += size;
    frames++;
  }
  if (!frames || offset !== bytes.length) throw unsupported();
  return seconds;
}

export function validateAudio(bytes: Buffer, mime: string): 'wav' | 'mp3' {
  if (bytes.length > MAX_AUDIO_BYTES) throw new ApiError(413, 'payload_too_large', 'La grabación supera los 3 MB');
  const format = ['audio/wav', 'audio/x-wav', 'audio/wave'].includes(mime) ? 'wav' : mime === 'audio/mpeg' ? 'mp3' : null;
  if (!format) throw unsupported();
  const seconds = format === 'wav' ? wavDuration(bytes) : mp3Duration(bytes);
  if (seconds > 60) throw new ApiError(413, 'payload_too_large', 'La grabación supera los 60 segundos');
  if (seconds < 0.4) throw badRequest('Habla durante al menos 400 milisegundos');
  return format;
}
