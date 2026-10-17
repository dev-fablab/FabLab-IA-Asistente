import type { InferResponseType } from 'hono/client';
import type { api } from '@/lib/api';

/** Documento tal como lo devuelve `GET /api/admin/documents`. */
export type DocumentRow = InferResponseType<typeof api.api.admin.documents.$get, 200>['documents'][number];
export type DocumentStatus = DocumentRow['status'];

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

// El bucket solo acepta estos tipos y el navegador a veces entrega los .docx con tipo
// vacío, así que se envía siempre el MIME canónico según la extensión.
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function canonicalMimeType(fileName: string): string | undefined {
  return MIME_BY_EXTENSION[extensionOf(fileName)];
}

/** Motivo por el que un archivo no se puede subir, o `null` si es válido (se revisa antes de subir). */
export function validateFile(file: File): string | null {
  if (!canonicalMimeType(file.name)) return 'Solo se aceptan archivos .pdf y .docx';
  if (file.size === 0) return 'El archivo está vacío';
  if (file.size > MAX_FILE_BYTES) return 'El archivo supera el máximo de 20 MB';
  return null;
}

/** Título propuesto a partir del nombre del archivo; la persona lo puede editar. */
export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const dateFormat = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (value: string | Date) => dateFormat.format(new Date(value));

/**
 * Sube el archivo directo a Storage con la URL firmada. Usa XHR y no `fetch` para poder
 * informar el progreso. El cuerpo es el mismo multipart que envía supabase-js.
 */
export function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  const mimeType = canonicalMimeType(file.name);
  if (!mimeType) return Promise.reject(new Error('Tipo de archivo no permitido'));

  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', new Blob([file], { type: mimeType }));

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('No se pudo subir el archivo'));
    xhr.onerror = () => reject(new Error('Se perdió la conexión al subir el archivo'));
    xhr.onabort = () => reject(new Error('Se canceló la subida'));
    xhr.send(body);
  });
}
