'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiRequestError, unwrap } from '@/lib/api';
import {
  canonicalMimeType,
  titleFromFileName,
  uploadToSignedUrl,
  validateFile,
  type DocumentRow,
} from '@/lib/documents';

export type UploadItem = {
  key: string;
  fileName: string;
  /** Etapa visible en la fila. */
  phase: 'uploading' | 'processing' | 'error';
  progress: number;
  error?: string;
};

type RegisterResult = { document: DocumentRow; upload: { path: string; token: string; signedUrl: string } };

/** Un archivo con el mismo hash ya cargado: la persona decide si continúa. */
export type DuplicatePrompt = { documentId: string; fileName: string; message: string };

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : 'Ocurrió un error inesperado');

/**
 * Flujo de subida del panel: valida el archivo, lo registra, lo sube directo a Storage con la
 * URL firmada y dispara el procesamiento. Soporta varios archivos a la vez y el reemplazo.
 */
export function useUploads(onChange: () => Promise<void>) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [duplicate, setDuplicate] = useState<DuplicatePrompt | null>(null);

  const patch = useCallback((key: string, changes: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }, []);

  const remove = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  /** Pide procesar; devuelve `true` si arrancó y `false` si hay que decidir sobre un duplicado. */
  const process = useCallback(
    async (documentId: string, fileName: string, force = false): Promise<boolean> => {
      const response = await api.api.admin.documents[':id'].process.$post({
        param: { id: documentId },
        query: force ? { force: 'true' } : {},
      });
      // Hono RPC solo tipa las respuestas explícitas del handler; 409 lo lanza el servidor como error.
      const status: number = response.status;
      if (status === 409) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        const message = body?.error?.message ?? 'No se pudo procesar el documento';
        // `ya se está procesando` también es 409: solo el duplicado pide confirmación.
        if (body?.error?.code === 'duplicate_document') {
          setDuplicate({ documentId, fileName, message });
          return false;
        }
        throw new ApiRequestError(message, 409, body?.error?.code ?? 'conflict');
      }
      await unwrap(response);
      return true;
    },
    [],
  );

  const start = useCallback(
    async (file: File, options: { replaceId?: string } = {}) => {
      const key = `${file.name}-${crypto.randomUUID()}`;
      const rejection = validateFile(file);
      if (rejection) {
        // Se rechaza antes de subir, con el motivo en la propia fila.
        setItems((current) => [...current, { key, fileName: file.name, phase: 'error', progress: 0, error: rejection }]);
        return;
      }

      setItems((current) => [...current, { key, fileName: file.name, phase: 'uploading', progress: 0 }]);
      const mimeType = canonicalMimeType(file.name)!;
      const metadata = { fileName: file.name, mimeType, sizeBytes: file.size };

      try {
        const registered = options.replaceId
          ? await unwrap<RegisterResult>(
              await api.api.admin.documents[':id'].replace.$post({ param: { id: options.replaceId }, json: metadata }),
            )
          : await unwrap<RegisterResult>(
              await api.api.admin.documents.$post({
                json: { ...metadata, title: titleFromFileName(file.name) },
              }),
            );
        void onChange();

        await uploadToSignedUrl(registered.upload.signedUrl, file, (progress) => patch(key, { progress }));
        patch(key, { phase: 'processing', progress: 100 });

        const started = await process(registered.document.id, file.name);
        if (started) toast.success(`«${file.name}» se está procesando`);
        remove(key);
      } catch (cause) {
        patch(key, { phase: 'error', error: errorMessage(cause) });
      } finally {
        await onChange();
      }
    },
    [onChange, patch, process, remove],
  );

  const startMany = useCallback(
    (files: File[]) => {
      files.forEach((file) => void start(file));
    },
    [start],
  );

  const confirmDuplicate = useCallback(async () => {
    if (!duplicate) return;
    const current = duplicate;
    setDuplicate(null);
    try {
      await process(current.documentId, current.fileName, true);
      toast.success(`«${current.fileName}» se está procesando`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      await onChange();
    }
  }, [duplicate, onChange, process]);

  /** La persona descarta el duplicado: se elimina el registro que quedó pendiente. */
  const cancelDuplicate = useCallback(async () => {
    if (!duplicate) return;
    const current = duplicate;
    setDuplicate(null);
    try {
      await api.api.admin.documents[':id'].$delete({ param: { id: current.documentId } });
    } finally {
      await onChange();
    }
  }, [duplicate, onChange]);

  return { items, startMany, start, remove, process, duplicate, confirmDuplicate, cancelDuplicate };
}
