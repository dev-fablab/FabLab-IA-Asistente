import { createTool } from '@mastra/core/tools';
import { documentChunks, documents, getDb } from '@fablab/db';
import { and, asc, cosineDistance, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { embedQuery } from '../embeddings';
import { getRetrievalEnv } from '../env';
import { logToolFailure } from '../log';

export const SEARCH_DOCUMENTS_TOOL_ID = 'searchDocuments';

const passageSchema = z.object({
  text: z.string(),
  title: z.string(),
  page: z.number().int().nullable(),
  score: z.number(),
});

export const searchDocumentsOutputSchema = z.object({
  found: z.boolean(),
  passages: z.array(passageSchema),
  /**
   * La búsqueda falló por un problema técnico (el modelo de embeddings, la base de datos…). No es lo mismo
   * que no encontrar nada: no significa que falte documentación y no debe responderse con conocimiento propio.
   */
  unavailable: z.boolean().optional(),
});

export type SearchDocumentsResult = z.infer<typeof searchDocumentsOutputSchema>;

/** Busca los fragmentos más cercanos a la pregunta entre los documentos `ready` que superan el umbral. */
async function search(query: string): Promise<SearchDocumentsResult> {
  const { RETRIEVAL_MIN_SCORE, RETRIEVAL_TOP_K } = getRetrievalEnv();
  const embedding = await embedQuery(query);

  const distance = cosineDistance(documentChunks.embedding, embedding);
  const similarity = sql<number>`1 - (${distance})`;

  const rows = await getDb()
    .select({
      text: documentChunks.content,
      page: documentChunks.page,
      title: documents.title,
      score: similarity,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(and(eq(documents.status, 'ready'), gt(similarity, RETRIEVAL_MIN_SCORE)))
    // Ordenar por distancia (no por similitud) permite usar el índice HNSW.
    .orderBy(asc(distance))
    .limit(RETRIEVAL_TOP_K);

  const passages = rows.map((row) => ({ ...row, score: Math.round(Number(row.score) * 1000) / 1000 }));
  return { found: passages.length > 0, passages };
}

/**
 * Busca en la documentación oficial. Es una de las dos capas de la política anti-alucinación:
 * solo devuelve fragmentos de documentos `ready` cuya similitud supera el umbral, de modo que
 * la veracidad no dependa solo de que el modelo «se porte bien».
 */
export const searchDocuments = createTool({
  id: SEARCH_DOCUMENTS_TOOL_ID,
  description:
    'Busca en la documentación oficial de Fab Lab los fragmentos relevantes para una pregunta. ' +
    'Úsala siempre antes de responder cualquier pregunta sobre Fab Lab.',
  inputSchema: z.object({
    query: z.string().min(3).max(500).describe('La pregunta o el tema a buscar, con las palabras de la persona'),
  }),
  outputSchema: searchDocumentsOutputSchema,
  execute: async ({ query }) => {
    try {
      return await search(query);
    } catch (error) {
      // Si la herramienta lanzara, Mastra le devolvería el error al modelo y este seguiría con otro paso:
      // podría reintentar varias veces (la persona ve el chat «colgado») o responder sin fuentes. En su
      // lugar se registra el fallo y se avisa con una señal explícita para que se comunique sin improvisar
      // (ver las instrucciones del agente).
      logToolFailure(SEARCH_DOCUMENTS_TOOL_ID, error);
      return { found: false, passages: [], unavailable: true };
    }
  },
});
