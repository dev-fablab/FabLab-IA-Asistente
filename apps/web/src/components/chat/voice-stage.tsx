'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useVoicePlayback } from '@/lib/voice/playback-store';
import { useVoiceControls } from '@/lib/voice/use-voice';
import { Mascot } from './mascot/mascot';
import styles from './voice-stage.module.css';

const ACTIVITY_HEIGHTS = [8, 14, 10, 22, 16, 28, 18, 24, 12, 30, 20, 26, 14, 24, 18, 28, 12, 20, 10, 16, 8];

/** El hilo permanece montado al cambiar de vista: mantiene mensajes, scroll y composición. */
export function VoiceStage({ children }: { children: ReactNode }) {
  const voice = useVoiceControls();
  const speaking = useVoicePlayback();
  const active = voice.state !== 'idle';
  const listening = !voice.microphoneMuted && (voice.state === 'listening' || voice.state === 'recording');

  return (
    <div className={styles.layout} data-voice-active={active}>
      <div className={styles.thread}>{children}</div>
      <div className={styles.stage} aria-hidden="true" data-speaking={speaking}>
        <div className={styles.glow} />
        <div className={styles.avatar}>
          <div className={styles.shadow} />
          <div className={styles.jumper}>
            <Mascot size="clamp(240px, 28vw, 400px)" speaking={speaking} mood={listening ? 'listening' : undefined} />
          </div>
        </div>
        <div className={styles.activity}>
          {ACTIVITY_HEIGHTS.map((height, index) => (
            <span key={index} className={styles.activityBar} style={{
              '--bar-height': `${height}px`,
              animationDelay: `${index * -83}ms`,
              animationDuration: `${480 + (index % 5) * 90}ms`,
            } as CSSProperties} />
          ))}
        </div>
        <div className={styles.caption}>
          <p className={styles.name}>Strobi</p>
          <p>{speaking ? 'Hablando contigo' : listening ? 'Te escucho' : 'Tu asistente de Fab Lab'}</p>
        </div>
      </div>
    </div>
  );
}
