import type { MicVAD } from '@ricky0123/vad-web';

export type VadCallbacks = {
  onSpeechStart(): void;
  onSpeechConfirmed(): void;
  onMisfire(): void;
  onSpeechEnd(audio: Float32Array): void;
  onLost(): void;
};
export interface VoiceDetector {
  destroy(): Promise<void>;
  setSpeaking(speaking: boolean): void;
  setListening(enabled: boolean): Promise<void>;
}

/** Importación y descarga diferidas: no se abre el micrófono antes de activar la voz. */
export async function createVad(callbacks: VadCallbacks, signal: AbortSignal): Promise<VoiceDetector> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('La voz necesita HTTPS y un navegador con acceso al micrófono. Puedes seguir escribiendo.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  signal.addEventListener('abort', release, { once: true });
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let detector: MicVAD | undefined;
  let listening = true;
  let destroyed = false;
  let transition = Promise.resolve();
  try {
    signal.throwIfAborted();
    const { MicVAD } = await import('@ricky0123/vad-web');
    signal.throwIfAborted();
    detector = await MicVAD.new({
      model: 'v5', startOnLoad: false,
      baseAssetPath: '/voice-assets/', onnxWASMBasePath: '/voice-assets/',
      // Un hilo WASM evita requerir aislamiento COOP/COEP para todo el chat.
      ortConfig: (ort) => { ort.env.wasm.numThreads = 1; },
      getStream: async () => stream,
      resumeStream: async () => stream,
      pauseStream: async () => undefined,
      positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35,
      minSpeechMs: 400, redemptionMs: 800, preSpeechPadMs: 300,
      submitUserSpeechOnPause: true,
      onSpeechStart: () => {
        if (signal.aborted || !listening) return;
        callbacks.onSpeechStart();
        clearTimeout(maxTimer);
        maxTimer = setTimeout(() => {
          // Pausar entrega el segmento acumulado y reinicia el detector sin acumular audio sin límite.
          void detector?.pause().then(() => { if (!signal.aborted && listening && !destroyed) return detector?.start(); });
        }, 59_500);
      },
      onSpeechRealStart: () => { if (!signal.aborted && listening) callbacks.onSpeechConfirmed(); },
      onVADMisfire: () => { clearTimeout(maxTimer); if (!signal.aborted && listening) callbacks.onMisfire(); },
      onSpeechEnd: (audio) => {
        clearTimeout(maxTimer);
        if (!signal.aborted && listening) callbacks.onSpeechEnd(audio.slice(0, 60 * 16000));
      },
    });
    signal.throwIfAborted();
    stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => { if (!signal.aborted) callbacks.onLost(); }));
    await detector.start();
    signal.throwIfAborted();
    return {
      async destroy() {
        destroyed = true;
        clearTimeout(maxTimer);
        release(); signal.removeEventListener('abort', release);
        await detector?.destroy();
      },
      setSpeaking(speaking) { detector?.setOptions({ positiveSpeechThreshold: speaking ? 0.7 : 0.5 }); },
      setListening(enabled) {
        listening = enabled;
        if (!enabled) {
          clearTimeout(maxTimer);
          stream.getAudioTracks().forEach((track) => { track.enabled = false; });
        }
        // Serializa pulsaciones rápidas: la última intención decide si se vuelve a abrir la captura.
        transition = transition.catch(() => undefined).then(async () => {
          if (destroyed || signal.aborted) return;
          if (!enabled) {
            // Una pausa manual descarta el fragmento incompleto, nunca lo envía a STT.
            detector?.setOptions({ submitUserSpeechOnPause: false });
            try { await detector?.pause(); }
            finally { detector?.setOptions({ submitUserSpeechOnPause: true }); }
          } else if (listening) {
            stream.getAudioTracks().forEach((track) => { track.enabled = true; });
            await detector?.start();
          }
        });
        return transition;
      },
    };
  } catch (error) {
    clearTimeout(maxTimer); release();
    signal.removeEventListener('abort', release);
    await detector?.destroy();
    throw error;
  }
}

