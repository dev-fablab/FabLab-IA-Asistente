import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const vadEntry = require.resolve('@ricky0123/vad-web');
const vadDir = path.dirname(vadEntry);
const ortDir = path.dirname(createRequire(vadEntry).resolve('onnxruntime-web/wasm'));
const destination = path.resolve(import.meta.dirname, '../public/voice-assets');
await mkdir(destination, { recursive: true });
for (const name of ['vad.worklet.bundle.min.js', 'silero_vad_v5.onnx']) {
  await copyFile(path.join(vadDir, name), path.join(destination, name));
}
// La selección exacta depende de las capacidades WASM del navegador (incluye Safari).
for (const name of await readdir(ortDir)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(name)) {
    await copyFile(path.join(ortDir, name), path.join(destination, name));
  }
}
console.log('VAD y ONNX preparados en /voice-assets (mismo origen).');
