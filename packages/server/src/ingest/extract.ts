import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { IngestError, NO_TEXT_MESSAGE } from './errors';
import type { FileKind } from './validate';

export type ExtractedPage = {
  /** Número de página (desde 1) en PDF; `null` en DOCX, que no tiene páginas fijas. */
  page: number | null;
  text: string;
};

/**
 * Deja el texto apto para Postgres y para el troceo: sin NUL (Postgres no los admite en
 * `text`), sin otros caracteres de control y con saltos de línea normalizados.
 */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedPage[]> {
  // unpdf transfiere el buffer al worker de pdf.js: se le pasa una copia.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((pageText, index) => ({ page: index + 1, text: cleanText(pageText) }));
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return [{ page: null, text: cleanText(value) }];
}

/**
 * Extrae el texto de un PDF (conservando la página) o de un DOCX. Si no hay texto,
 * por ejemplo un PDF escaneado, falla con un motivo legible: el OCR no está en la Fase 1.
 */
export async function extractPages(bytes: Uint8Array, kind: FileKind): Promise<ExtractedPage[]> {
  let pages: ExtractedPage[];
  try {
    pages = kind === 'pdf' ? await extractPdf(bytes) : await extractDocx(bytes);
  } catch (error) {
    throw new IngestError('No se pudo leer el archivo; puede estar dañado o protegido', { cause: error });
  }

  const withText = pages.filter((page) => page.text.length > 0);
  if (withText.length === 0) throw new IngestError(NO_TEXT_MESSAGE);
  return withText;
}
