'use client';

import type { CSSProperties } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import { useVoicePlayback } from '@/lib/voice/playback-store';
import { useVoiceControls } from '@/lib/voice/use-voice';
import { Mascot } from './mascot/mascot';
import styles from './mobile-voice-controls.module.css';

const LEVELS = [12, 20, 28, 18, 34, 24, 30, 16, 26, 32, 20, 12];

/** En móvil sustituye la caja de texto mientras la conversación por voz está activa. */
export function MobileVoiceControls() {
  const voice = useVoiceControls();
  const playing = useVoicePlayback();
  if (voice.state === 'idle') return null;
  const activity = playing || (voice.state === 'recording' && !voice.microphoneMuted);
  const preparing = voice.state === 'starting';
  const responding = playing || voice.state === 'thinking' || voice.state === 'speaking';
  const listening = !voice.microphoneMuted && (voice.state === 'listening' || voice.state === 'recording');

  return (
    <div className={styles.controls} role="group" aria-label="Controles de conversación por voz" data-active={activity}>
      <button type="button" className={`${styles.button} ${styles.mascot}`} data-speaking={playing}
        aria-label="Strobi: interrumpir respuesta" disabled={!responding} onClick={voice.stopResponse}>
        <div className={styles.mascotMotion}>
          <Mascot size={52} speaking={playing} mood={listening ? 'listening' : undefined} />
        </div>
      </button>
      <div className={styles.waveform} aria-hidden="true">
        {LEVELS.map((height, index) => (
          <span key={index} className={styles.dot} style={{
            '--level-height': `${height}px`,
            animationDelay: `${index * -91}ms`,
            animationDuration: `${460 + (index % 4) * 100}ms`,
          } as CSSProperties} />
        ))}
      </div>
      <button type="button" className={`${styles.button} ${styles.microphone}`}
        aria-label={voice.microphoneMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
        aria-pressed={voice.microphoneMuted} disabled={preparing} onClick={voice.toggleMicrophone}>
        {voice.microphoneMuted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
      </button>
      <button type="button" className={`${styles.button} ${styles.close}`} aria-label="Cerrar modo de voz" onClick={voice.stop}>
        <X aria-hidden />
      </button>
    </div>
  );
}
