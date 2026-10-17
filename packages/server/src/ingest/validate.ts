import { ApiError } from '../errors';

/** Tamaño máximo de un documento (RF-11). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const FILE_KINDS = {
  pdf: { mimeType: 'application/pdf' },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
} as const;

export type FileKind = keyof typeof FILE_KINDS;

const MAX_FILE_NAME_LENGTH = 120;

/** Tipo de archivo según la extensión (el punto es obligatorio), o `null` si no está permitido. */
export function kindFromFileName(fileName: string): FileKind | null {
  const match = /\.(pdf|docx)$/i.exec(fileName);
  return match ? (match[1]!.toLowerCase() as FileKind) : null;
}

/**
 * Deja un nombre seguro para usar como ruta de Storage: sin separadores de ruta,
 * sin caracteres de control y con la extensión original en minúsculas.
 */
export function sanitizeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .normalize('NFC');

  // La extensión se separa primero para que el saneado del nombre no la dañe.
  const kind = kindFromFileName(base);
  const rawStem = kind ? base.slice(0, base.length - kind.length - 1) : base;
  const maxStem = MAX_FILE_NAME_LENGTH - (kind ? kind.length + 1 : 0);

  const stem = rawStem
    .replace(/[^\p{L}\p{N}._ ()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, maxStem)
    .trim();

  return `${stem || 'documento'}${kind ? `.${kind}` : ''}`;
}

export type UploadRequest = { fileName: string; mimeType: string; sizeBytes: number };

/**
 * Valida la solicitud de subida antes de emitir la URL firmada: extensión, tipo MIME,
 * coherencia entre ambos y tamaño. La firma real del archivo se revisa tras la subida.
 */
export function validateUploadRequest(request: UploadRequest): { kind: FileKind; fileName: string; mimeType: string } {
  const fileName = sanitizeFileName(request.fileName);
  const kind = kindFromFileName(fileName);

  if (!kind) {
    throw new ApiError(415, 'unsupported_media_type', 'Solo se aceptan archivos .pdf y .docx');
  }
  if (request.mimeType !== FILE_KINDS[kind].mimeType) {
    throw new ApiError(415, 'unsupported_media_type', 'El tipo del archivo no coincide con su extensión');
  }
  if (request.sizeBytes <= 0) {
    throw new ApiError(400, 'bad_request', 'El archivo está vacío');
  }
  if (request.sizeBytes > MAX_FILE_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'El archivo supera el máximo de 20 MB');
  }
  return { kind, fileName, mimeType: FILE_KINDS[kind].mimeType };
}

const PDF_SIGNATURE = Buffer.from('%PDF-');
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DOCX_MAIN_PART = Buffer.from('word/document.xml');

/**
 * Comprueba el contenido real del archivo, no lo que declara el navegador:
 * `%PDF-` para PDF (el estándar tolera hasta 1 KB previo) y contenedor ZIP con
 * `word/document.xml` para DOCX.
 */
export function hasValidSignature(bytes: Uint8Array, kind: FileKind): boolean {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (kind === 'pdf') {
    return buffer.subarray(0, 1024).includes(PDF_SIGNATURE);
  }
  return buffer.subarray(0, 4).equals(ZIP_SIGNATURE) && buffer.includes(DOCX_MAIN_PART);
}
