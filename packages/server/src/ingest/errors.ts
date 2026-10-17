/**
 * Falla de ingesta con un mensaje apto para mostrarse en el panel (`documents.error_message`).
 * Cualquier otro error se registra y se muestra con un mensaje genérico.
 */
export class IngestError extends Error {
  override name = 'IngestError';
}

export const NO_TEXT_MESSAGE = 'El archivo no contiene texto; el OCR no está incluido en la Fase 1';
