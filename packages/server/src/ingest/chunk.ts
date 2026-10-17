import { MDocument } from '@mastra/rag';
import type { ExtractedPage } from './extract';

/**
 * Valores iniciales del troceo (spec §5). `maxSize` se mide en caracteres, no en tokens:
 * 512 caracteres son unos 100-130 tokens. Se calibran con los documentos reales de Fab Lab.
 */
export const CHUNK_OPTIONS = { maxSize: 512, overlap: 50 } as const;

export type TextChunk = {
  chunkIndex: number;
  page: number | null;
  content: string;
};

/**
 * Trocea cada página por separado con la estrategia `recursive`, de modo que cada
 * fragmento conserva el número de página para citar la fuente.
 */
export async function chunkPages(pages: ExtractedPage[]): Promise<TextChunk[]> {
  const chunks: TextChunk[] = [];

  for (const { page, text } of pages) {
    const pieces = await MDocument.fromText(text).chunk({ strategy: 'recursive', ...CHUNK_OPTIONS });
    for (const piece of pieces) {
      const content = piece.text.trim();
      if (content) chunks.push({ chunkIndex: chunks.length, page, content });
    }
  }

  return chunks;
}
