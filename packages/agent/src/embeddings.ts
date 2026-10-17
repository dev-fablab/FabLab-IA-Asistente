import { EMBEDDING_DIMENSIONS } from '@fablab/db';
import { embed, embedMany } from 'ai';
import { getEmbeddingModel } from './models';

/** Tamaño de lote al generar embeddings de un documento (spec §5, paso 4). */
export const EMBEDDING_BATCH_SIZE = 100;

function assertDimensions(vector: number[]) {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `El modelo de embeddings devolvió ${vector.length} dimensiones y la columna vector espera ${EMBEDDING_DIMENSIONS}. ` +
        'Revisa EMBEDDING_MODEL y EMBEDDING_DIMENSION.',
    );
  }
}

/** Embeddings de los fragmentos de un documento, en lotes, en el mismo orden de entrada. */
export async function embedDocuments(values: string[]): Promise<number[][]> {
  const model = getEmbeddingModel('document');
  const vectors: number[][] = [];

  for (let start = 0; start < values.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = values.slice(start, start + EMBEDDING_BATCH_SIZE);
    const { embeddings } = await embedMany({ model, values: batch });
    if (embeddings.length !== batch.length) {
      throw new Error('El modelo de embeddings devolvió una cantidad inesperada de vectores');
    }
    vectors.push(...embeddings);
  }

  vectors.forEach(assertDimensions);
  return vectors;
}

/** Embedding de una consulta de la persona (búsqueda en `searchDocuments`). */
export async function embedQuery(value: string): Promise<number[]> {
  const { embedding } = await embed({ model: getEmbeddingModel('query'), value });
  assertDimensions(embedding);
  return embedding;
}
