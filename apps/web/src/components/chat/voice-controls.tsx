'use client';

import { useAuiState } from '@assistant-ui/react';
import { Mic, MicOff, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVoiceControls } from '@/lib/voice/use-voice';
import type { VoiceState } from '@/lib/voice/controller';

const LABELS: Record<VoiceState, string> = {
  idle: 'Voz desactivada', starting: 'Preparando micrófono…', listening: 'Escuchando',
  recording: 'Grabando', transcribing: 'Transcribiendo', thinking: 'Pensando', speaking: 'Hablando',
};

export function VoiceToggle() {
  const voice = useVoiceControls();
  const running = useAuiState((s) => s.thread.isRunning);
  const active = voice.state !== 'idle';
  return (
    <Button type="button" variant={active ? 'default' : 'ghost'} size="icon"
      className="shrink-0 rounded-full" aria-label={active ? 'Desactivar voz' : 'Activar voz'}
      aria-pressed={active} disabled={!active && running} onClick={active ? voice.stop : voice.start}>
      {active ? <MicOff /> : <Mic />}
    </Button>
  );
}

export function VoiceStatus() {
  const voice = useVoiceControls();
  return (
    <>
      {voice.state !== 'idle' && (
        <div className="mt-2 flex items-center justify-center gap-3 text-sm">
          <span role="status" aria-live="polite">{voice.microphoneMuted && voice.state === 'listening' ? 'Micrófono silenciado' : LABELS[voice.state]}</span>
          {(voice.state === 'speaking' || voice.state === 'thinking') && (
            <button type="button" className="hidden items-center gap-1 underline lg:flex" onClick={voice.stopResponse}>
              <Square size={12} />Detener voz
            </button>
          )}
        </div>
      )}
      {voice.error && <p role="alert" className="mt-2 text-center text-sm text-destructive">{voice.error}</p>}
    </>
  );
}
