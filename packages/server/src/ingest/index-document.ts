import { createHash } from 'node:crypto';
import { ConfigurationError } from '@fablab/agent/env';
import { embedDocuments } from '@fablab/agent/embeddings';
import { documentChunks, documents, getDb, type Document } from '@fablab/db';
import { downloadObject, listFolder, removeObjects } from '@fablab/db/storage';
import { and, eq, lt, ne, or } from 'drizzle-orm';
import { ApiError } from '../errors';
import { logger } from '../logger';
import { chunkPages } from './chunk';
import { IngestError, NO_TEXT_MESSAGE } from './errors';
import { extractPages } from './extract';
import { hasValidSignature, kindFromFileName, MAX_FILE_BYTES } from './validate';

/** Un documento en `processing` por más tiempo se considera atascado y se puede reintentar. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

const INSERT_BATCH_SIZE = 200;
const GENERIC_FAILURE = 'No se pudo procesar el documento. Reintenta; si persiste, avisa al equipo técnico';

export function isStuck(document: Pick<Document, 'status' | 'updatedAt'>, now = Date.now()): boolean {
  return document.status === 'processing' && now - document.updatedAt.getTime() > STUCK_AFTER_MS;
}

async function markFailed(documentId: string, message: string) {
  await getDb()
    .update(documents)
    .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

/**
 * Parte síncrona de «procesar»: valida el archivo ya subido, detecta duplicados por hash y
 * reclama el documento de forma atómica (`processing`). Así los errores del archivo llegan
 * a la persona como respuesta HTTP y no solo como un estado en la tabla.
 *
 * - 404: el archivo no está en Storage.
 * - 415 / 413: el contenido no es un PDF/DOCX válido o excede 20 MB (el documento queda `failed`).
 * - 409: duplicado (mismo hash, salvo `force`) o ya se está procesando.
 */
export async function prepareIngestion(documentId: string, options: { force?: boolean } = {}): Promise<Document> {
  const db = getDb();

  const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) throw new ApiError(404, 'not_found', 'Documento no encontrado');
  if (document.status === 'processing' && !isStuck(document)) {
    throw new ApiError(409, 'conflict', 'El documento ya se está procesando');
  }

  let bytes: Uint8Array;
  try {
    bytes = await downloadObject(document.storagePath);
  } catch (error) {
    logger.warn('ingest.download_failed', { documentId, reason: String(error) });
    throw new ApiError(404, 'not_found', 'El archivo no está en el almacenamiento; vuelve a subirlo');
  }

  const kind = kindFromFileName(document.fileName);
  if (bytes.length > MAX_FILE_BYTES) {
    const message = 'El archivo supera el máximo de 20 MB';
    await markFailed(documentId, message);
    throw new ApiError(413, 'payload_too_large', message);
  }
  if (!kind || !hasValidSignature(bytes, kind)) {
    const message = 'El contenido no corresponde a un archivo PDF o DOCX válido';
    await markFailed(documentId, message);
    throw new ApiError(415, 'unsupported_media_type', message);
  }

  const contentHash = createHash('sha256').update(bytes).digest('hex');
  if (!options.force) {
    // Un documento `failed` no aporta conocimiento: no bloquea volver a subir el mismo archivo.
    const [duplicate] = await db
      .select({ title: documents.title })
      .from(documents)
      .where(
        and(
          eq(documents.contentHash, contentHash),
          ne(documents.id, documentId),
          ne(documents.status, 'failed'),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ApiError(409, 'duplicate_document', `Este archivo ya está cargado como «${duplicate.title}»`);
    }
  }

  const [claimed] = await db
    .update(documents)
    .set({
      status: 'processing',
      errorMessage: null,
      contentHash,
      sizeBytes: bytes.length,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(documents.id, documentId),
        or(ne(documents.status, 'processing'), lt(documents.updatedAt, new Date(Date.now() - STUCK_AFTER_MS))),
      ),
    )
    .returning();
  if (!claimed) throw new ApiError(409, 'conflict', 'El documento ya se está procesando');
  return claimed;
}

async function embedChunks(texts: string[]): Promise<number[][]> {
  try {
    return await embedDocuments(texts);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw new IngestError('La configuración de los modelos está incompleta; avisa al equipo técnico', { cause: error });
    }
    throw new IngestError('No se pudieron generar los embeddings; inténtalo de nuevo más tarde', { cause: error });
  }
}

/** Borra de Storage las versiones anteriores de un documento reemplazado (mejor esfuerzo). */
async function removeStaleVersions(document: Document) {
  try {
    const stale = (await listFolder(document.id)).filter((path) => path !== document.storagePath);
    await removeObjects(stale);
  } catch (error) {
    logger.warn('ingest.stale_cleanup_failed', { documentId: document.id, reason: String(error) });
  }
}

/**
 * Parte en segundo plano: extrae el texto, lo trocea, genera los embeddings e indexa en una
 * transacción (borra los fragmentos previos, lo que hace idempotente el reproceso). Nunca lanza:
 * cualquier error deja el documento en `failed` con un motivo visible.
 */
export async function runIngestion(documentId: string): Promise<void> {
  const db = getDb();
  const started = Date.now();

  try {
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!document) return;

    const kind = kindFromFileName(document.fileName);
    if (!kind) throw new IngestError('Tipo de archivo no permitido');

    const bytes = await downloadObject(document.storagePath);
    const pages = await extractPages(bytes, kind);
    const chunks = await chunkPages(pages);
    if (chunks.length === 0) throw new IngestError(NO_TEXT_MESSAGE);

    const embeddings = await embedChunks(chunks.map((chunk) => chunk.content));

    await db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));

      for (let start = 0; start < chunks.length; start += INSERT_BATCH_SIZE) {
        await tx.insert(documentChunks).values(
          chunks.slice(start, start + INSERT_BATCH_SIZE).map((chunk, offset) => ({
            documentId,
            chunkIndex: chunk.chunkIndex,
            page: chunk.page,
            content: chunk.content,
            embedding: embeddings[start + offset]!,
          })),
        );
      }

      const updated = await tx
        .update(documents)
        .set({ status: 'ready', chunkCount: chunks.length, errorMessage: null, updatedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.status, 'processing')))
        .returning({ id: documents.id });
      // Si el documento se eliminó o cambió mientras tanto, se revierte todo.
      if (updated.length === 0) throw new IngestError('El documento cambió durante el procesamiento');
    });

    await removeStaleVersions(document);
    logger.info('ingest.done', { documentId, chunks: chunks.length, ms: Date.now() - started });
  } catch (error) {
    const known = error instanceof IngestError;
    logger.error('ingest.failed', error, { documentId, ms: Date.now() - started });
    await markFailed(documentId, known ? error.message : GENERIC_FAILURE).catch((markError) =>
      logger.error('ingest.mark_failed_error', markError, { documentId }),
    );
  }
}
