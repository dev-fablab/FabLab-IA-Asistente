import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { documents, getDb, type Document } from '@fablab/db';
import {
  createSignedDownloadUrl,
  createSignedUpload,
  DOWNLOAD_URL_TTL_SECONDS,
  listFolder,
  removeObjects,
  type SignedUpload,
} from '@fablab/db/storage';
import { ApiError, notFound } from '../errors';
import { isStuck } from '../ingest/index-document';
import { validateUploadRequest, type UploadRequest } from '../ingest/validate';

export type DocumentView = Document & { stuck: boolean };

const toView = (document: Document): DocumentView => ({ ...document, stuck: isStuck(document) });

/** Título propuesto cuando no se envía uno: el nombre del archivo sin extensión. */
function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Documento';
}

async function getDocument(id: string): Promise<Document> {
  const [document] = await getDb().select().from(documents).where(eq(documents.id, id));
  if (!document) throw notFound('Documento no encontrado');
  return document;
}

/**
 * Registra el documento en `pending` y devuelve la URL firmada para que el navegador suba el
 * archivo directo a Storage (las funciones de Vercel limitan el cuerpo a 4,5 MB).
 */
export async function createDocument(
  input: UploadRequest & { title?: string | undefined },
  uploadedBy: string,
): Promise<{ document: DocumentView; upload: SignedUpload }> {
  const file = validateUploadRequest(input);
  const id = randomUUID();
  const storagePath = `${id}/${file.fileName}`;

  const [document] = await getDb()
    .insert(documents)
    .values({
      id,
      title: input.title?.trim() || titleFromFileName(file.fileName),
      fileName: file.fileName,
      storagePath,
      mimeType: file.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedBy,
    })
    .returning();

  try {
    return { document: toView(document!), upload: await createSignedUpload(storagePath) };
  } catch (error) {
    await getDb().delete(documents).where(eq(documents.id, id));
    throw error;
  }
}

export async function listDocuments(): Promise<DocumentView[]> {
  const rows = await getDb().select().from(documents).orderBy(desc(documents.createdAt));
  return rows.map(toView);
}

export async function updateDocument(
  id: string,
  patch: { title?: string | undefined; description?: string | null | undefined },
): Promise<DocumentView> {
  const [document] = await getDb()
    .update(documents)
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      // `updated_at` marca el inicio del procesamiento: editar el título no debe reiniciar ese reloj.
      updatedAt: sql`case when ${documents.status} = 'processing' then ${documents.updatedAt} else now() end`,
    })
    .where(eq(documents.id, id))
    .returning();
  if (!document) throw notFound('Documento no encontrado');
  return toView(document);
}

/**
 * Prepara el reemplazo: el documento conserva su identificador, vuelve a `pending` (deja de ser
 * consultable hasta reprocesarlo) y se devuelve la URL firmada para subir la nueva versión.
 * Luego el panel llama a `process`.
 */
export async function startReplace(
  id: string,
  input: UploadRequest,
): Promise<{ document: DocumentView; upload: SignedUpload }> {
  const current = await getDocument(id);
  if (current.status === 'processing' && !isStuck(current)) {
    throw new ApiError(409, 'conflict', 'El documento se está procesando; espera a que termine');
  }

  const file = validateUploadRequest(input);
  const storagePath = `${id}/${file.fileName}`;
  const upload = await createSignedUpload(storagePath);

  const [document] = await getDb()
    .update(documents)
    .set({
      fileName: file.fileName,
      storagePath,
      mimeType: file.mimeType,
      sizeBytes: input.sizeBytes,
      contentHash: null,
      status: 'pending',
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, id))
    .returning();
  return { document: toView(document!), upload };
}

/** URL firmada de descarga del original (15 minutos). */
export async function getDownload(id: string) {
  const document = await getDocument(id);
  if (document.status === 'pending') {
    throw new ApiError(409, 'conflict', 'El archivo aún no se ha subido');
  }
  const url = await createSignedDownloadUrl(document.storagePath, { downloadName: document.fileName });
  return { url, fileName: document.fileName, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
}

/**
 * Elimina el archivo (y versiones anteriores) de Storage y luego la fila; los fragmentos caen
 * en cascada. Si falla el borrado del archivo, la fila se conserva para que el panel muestre el error.
 */
export async function deleteDocument(id: string): Promise<void> {
  const document = await getDocument(id);

  try {
    const paths = new Set([document.storagePath, ...(await listFolder(document.id))]);
    await removeObjects([...paths]);
  } catch (error) {
    throw new ApiError(
      500,
      'internal_error',
      'No se pudo borrar el archivo; el documento se conservó. Inténtalo de nuevo',
      { cause: error },
    );
  }

  await getDb().delete(documents).where(eq(documents.id, id));
}
