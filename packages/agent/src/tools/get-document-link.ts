import { createTool } from '@mastra/core/tools';
import { documents, getDb } from '@fablab/db';
import { createSignedDownloadUrl, DOWNLOAD_URL_TTL_SECONDS } from '@fablab/db/storage';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { logToolFailure } from '../log';

export const GET_DOCUMENT_LINK_TOOL_ID = 'getDocumentLink';

const MAX_MATCHES = 3;

export const getDocumentLinkOutputSchema = z.object({
  matches: z.array(
    z.object({
      title: z.string(),
      fileName: z.string(),
      url: z.string(),
      expiresInMinutes: z.number(),
    }),
  ),
  /** La búsqueda o la firma del enlace falló por un problema técnico: no significa que no exista el documento. */
  unavailable: z.boolean().optional(),
});

export type GetDocumentLinkResult = z.infer<typeof getDocumentLinkOutputSchema>;

/** Escapa `%`, `_` y `\` para que la consulta de la persona se trate como texto literal en un LIKE. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Palabras de petición que no identifican a ningún documento («dame el documento…»). */
const STOP_WORDS = new Set([
  'documento', 'documentos', 'archivo', 'archivos', 'descargar', 'enlace', 'link', 'dame', 'pasame', 'pásame',
  'quiero', 'necesito', 'favor', 'puedes', 'podrías', 'podrias', 'tienes', 'busca', 'buscar', 'muestra',
]);

/** Términos de búsqueda: la consulta completa y sus palabras significativas (4+ letras, sin las genéricas). */
function searchTerms(query: string): string[] {
  const normalized = query.trim();
  const words = normalized
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  return [...new Set([normalized, ...words])].slice(0, 6);
}

/** El término aparece en el título, el nombre del archivo o la descripción. */
function matchesTerm(term: string): SQL {
  const pattern = `%${escapeLike(term)}%`;
  return or(ilike(documents.title, pattern), ilike(documents.fileName, pattern), ilike(documents.description, pattern))!;
}

/** Busca los documentos que coinciden con la consulta y firma sus enlaces de descarga. */
async function findLinks(query: string): Promise<GetDocumentLinkResult> {
  const terms = searchTerms(query);
  // Orden por relevancia: cada término coincidente suma 1 y la consulta completa suma 3, de modo que
  // «reglamento de uso» gane a un documento que solo comparte una palabra suelta.
  const relevance = sql<number>`${sql.join(
    terms.map((term, index) => sql`(case when ${matchesTerm(term)} then ${index === 0 ? 3 : 1} else 0 end)`),
    sql` + `,
  )}`;

  const rows = await getDb()
    .select({ title: documents.title, fileName: documents.fileName, storagePath: documents.storagePath })
    .from(documents)
    .where(and(eq(documents.status, 'ready'), or(...terms.map(matchesTerm))))
    .orderBy(desc(relevance), desc(documents.updatedAt))
    .limit(MAX_MATCHES);

  const matches = await Promise.all(
    rows.map(async (row) => ({
      title: row.title,
      fileName: row.fileName,
      url: await createSignedDownloadUrl(row.storagePath, { downloadName: row.fileName }),
      expiresInMinutes: DOWNLOAD_URL_TTL_SECONDS / 60,
    })),
  );
  return { matches };
}

/**
 * Entrega el documento original cuando la persona lo pide: busca por título, nombre de archivo
 * o descripción entre los documentos `ready` y firma la URL en ese momento (15 minutos).
 * No existe ninguna URL pública permanente.
 */
export const getDocumentLink = createTool({
  id: GET_DOCUMENT_LINK_TOOL_ID,
  description:
    'Obtiene un enlace de descarga temporal del documento original de Fab Lab que la persona pide. ' +
    'Recibe el título o el tema del documento. Si no hay coincidencias devuelve una lista vacía.',
  inputSchema: z.object({
    query: z.string().min(2).max(200).describe('Título o tema del documento que la persona quiere descargar'),
  }),
  outputSchema: getDocumentLinkOutputSchema,
  execute: async ({ query }) => {
    try {
      return await findLinks(query);
    } catch (error) {
      logToolFailure(GET_DOCUMENT_LINK_TOOL_ID, error);
      return { matches: [], unavailable: true };
    }
  },
});
