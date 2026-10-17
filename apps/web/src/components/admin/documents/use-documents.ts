'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import type { DocumentRow } from '@/lib/documents';

/** Cada cuánto se consulta la lista mientras haya documentos en pending o processing (spec §5). */
export const POLL_INTERVAL_MS = 3000;

async function fetchDocuments(): Promise<DocumentRow[]> {
  const data = await unwrap<{ documents: DocumentRow[] }>(await api.api.admin.documents.$get());
  return data.documents;
}

const loadErrorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'No se pudo cargar la lista de documentos';

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await fetchDocuments());
      setError(null);
    } catch (cause) {
      setError(loadErrorMessage(cause));
    }
  }, []);

  // Carga inicial. La bandera evita escribir estado si el componente se desmonta antes de responder.
  useEffect(() => {
    let ignore = false;
    fetchDocuments()
      .then((loaded) => {
        if (ignore) return;
        setDocuments(loaded);
        setError(null);
      })
      .catch((cause) => {
        if (!ignore) setError(loadErrorMessage(cause));
      });
    return () => {
      ignore = true;
    };
  }, []);

  const hasActiveDocuments = documents?.some((d) => d.status === 'pending' || d.status === 'processing') ?? false;

  useEffect(() => {
    if (!hasActiveDocuments) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActiveDocuments, refresh]);

  return { documents, error, loading: documents === null && error === null, refresh };
}
