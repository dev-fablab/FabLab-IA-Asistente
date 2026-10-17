'use client';

import { ActionBarPrimitive, MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { publicApi } from '@/lib/api';
import { describeChatError } from '@/lib/chat/errors';
import { ContactList } from './tool-uis';

type Channels = Parameters<typeof ContactList>[0]['channels'];

/** Canales activos, para ofrecerlos cuando el asistente no está disponible (RNF de disponibilidad). */
function useContactChannels(enabled: boolean) {
  const [channels, setChannels] = useState<Channels>([]);

  useEffect(() => {
    if (!enabled) return;
    let ignore = false;
    publicApi.api.chat.contact
      .$get()
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!ignore && body) setChannels(body.channels);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [enabled]);

  return channels;
}

function ErrorBody({ error }: { error: unknown }) {
  const info = describeChatError(error);
  const channels = useContactChannels(info.showContact);
  const retryable = info.kind !== 'invalid';

  return (
    <div role="alert" className="mt-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
      <p className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {info.message}
      </p>
      {channels.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs text-muted-foreground">Canales de contacto de Fab Lab</p>
          <ContactList channels={channels} />
        </div>
      )}
      {retryable && (
        <ActionBarPrimitive.Reload asChild>
          <Button variant="outline" size="sm" className="mt-3">
            <RotateCcw aria-hidden /> Reintentar
          </Button>
        </ActionBarPrimitive.Reload>
      )}
    </div>
  );
}

/** Error de una respuesta: mensaje claro con «Reintentar» y, si corresponde, los canales de contacto. */
export function ChatError() {
  const error = useAuiState((s) => (s.message.status?.type === 'incomplete' ? s.message.status.error : undefined));
  return (
    <MessagePrimitive.Error>
      <ErrorBody error={error} />
    </MessagePrimitive.Error>
  );
}
