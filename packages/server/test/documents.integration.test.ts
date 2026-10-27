import { documentChunks, documents, EMBEDDING_DIMENSIONS, getDb } from '@fablab/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { NO_TEXT_MESSAGE } from '../src/ingest/errors';
import { FILE_KINDS, MAX_FILE_BYTES } from '../src/ingest/validate';
import { makeDocx, makePdf } from './fixtures';
import { anonClient, createTestUser, fakeEmbedding, serviceClient, type TestUser } from './helpers/integration';

// Los embeddings reales requieren OpenRouter: aquí se reemplazan por vectores deterministas
// para probar la base de datos, Storage, la extracción y la transacción de indexado.
vi.mock('@fablab/agent/embeddings', () => ({
  embedDocuments: async (texts: string[]) => texts.map((text) => fakeEmbedding(text)),
}));

// `BlobPart` es un tipo del DOM; aquí solo hay tipos de Node.
type BlobSource = ConstructorParameters<typeof Blob>[0] extends Iterable<infer T> | undefined ? T : never;

const PDF = FILE_KINDS.pdf.mimeType;
const DOCX = FILE_KINDS.docx.mimeType;

const background: Promise<void>[] = [];
const app = createApp({
  basePath: '/api',
  scheduleBackground: (task) => {
    background.push(task());
  },
});
const settleBackground = async () => {
  await Promise.all(background.splice(0));
};

let staff: TestUser;
const createdDocumentIds: string[] = [];

type DocumentJson = {
  id: string;
  title: string;
  fileName: string;
  storagePath: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  errorMessage: string | null;
  chunkCount: number;
  contentHash: string | null;
  stuck: boolean;
};

const call = async (method: string, path: string, body?: unknown, cookie = staff.cookie) =>
  app.request(`/api/admin${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** Sube el archivo a la URL firmada con su MIME canónico (el bucket rechaza otros tipos). */
async function putToSignedUrl(signed: { path: string; token: string }, bytes: Uint8Array, mimeType: string) {
  const { error } = await serviceClient()
    .storage.from('documents')
    .uploadToSignedUrl(signed.path, signed.token, new Blob([bytes as BlobSource], { type: mimeType }), {
      contentType: mimeType,
    });
  expect(error).toBeNull();
}

/** Registra el documento y sube el archivo con la URL firmada, como lo hace el panel. */
async function upload(bytes: Uint8Array, fileName: string, mimeType: string, title?: string) {
  const res = await call('POST', '/documents', { fileName, mimeType, sizeBytes: bytes.length, ...(title ? { title } : {}) });
  expect(res.status).toBe(201);
  const { document, upload: signed } = (await res.json()) as {
    document: DocumentJson;
    upload: { path: string; token: string };
  };
  createdDocumentIds.push(document.id);
  await putToSignedUrl(signed, bytes, mimeType);
  return document;
}

const processDocument = (id: string, force = false) => call('POST', `/documents/${id}/process${force ? '?force=true' : ''}`);

async function getStatus(id: string): Promise<DocumentJson> {
  const list = (await (await call('GET', '/documents')).json()) as { documents: DocumentJson[] };
  const found = list.documents.find((d) => d.id === id);
  if (!found) throw new Error('Documento no encontrado en el listado');
  return found;
}

const folderObjects = async (id: string) =>
  ((await serviceClient().storage.from('documents').list(id)).data ?? []).map((o) => o.name);

const ingestPdf = async (text: string, name = `guia-${Math.random().toString(36).slice(2, 8)}.pdf`) => {
  const document = await upload(makePdf([text]), name, PDF);
  expect((await processDocument(document.id)).status).toBe(202);
  await settleBackground();
  return document;
};

beforeAll(async () => {
  staff = await createTestUser('staff');
});

afterAll(async () => {
  for (const id of createdDocumentIds) {
    await call('DELETE', `/documents/${id}`).catch(() => undefined);
  }
  await staff?.remove();
});

describe('flujo completo: subir, procesar, listar', () => {
  it('un PDF queda en ready con fragmentos, páginas y hash', async () => {
    const document = await upload(
      makePdf(['Fab Lab es un laboratorio de fabricacion digital.', 'Ofrece impresion 3D y corte laser a la comunidad.']),
      'guia de servicios.pdf',
      PDF,
      'Guía de servicios',
    );
    expect(document).toMatchObject({ status: 'pending', title: 'Guía de servicios', fileName: 'guia de servicios.pdf' });

    const res = await processDocument(document.id);
    expect(res.status).toBe(202);
    expect(((await res.json()) as { document: DocumentJson }).document.status).toBe('processing');

    await settleBackground();

    const ready = await getStatus(document.id);
    expect(ready).toMatchObject({ status: 'ready', errorMessage: null, stuck: false });
    expect(ready.chunkCount).toBeGreaterThanOrEqual(2);
    expect(ready.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const chunks = await getDb().select().from(documentChunks).where(eq(documentChunks.documentId, document.id));
    expect(chunks).toHaveLength(ready.chunkCount);
    expect([...new Set(chunks.map((c) => c.page))].sort()).toEqual([1, 2]);
    expect(chunks.every((c) => c.embedding.length === EMBEDDING_DIMENSIONS)).toBe(true);
  });

  it('un DOCX queda en ready sin número de página', async () => {
    const bytes = await makeDocx(['Fab Lab recibe solicitudes de proyectos.', 'Cada proyecto se evalua por el equipo.']);
    const document = await upload(bytes, 'proyectos.docx', DOCX);
    expect((await processDocument(document.id)).status).toBe(202);
    await settleBackground();

    expect(await getStatus(document.id)).toMatchObject({ status: 'ready', errorMessage: null });
    const chunks = await getDb().select().from(documentChunks).where(eq(documentChunks.documentId, document.id));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.page === null)).toBe(true);
  });

  it('propone el título a partir del nombre del archivo', async () => {
    const document = await upload(makePdf(['x']), 'reglamento_de_uso.pdf', PDF);
    expect(document.title).toBe('reglamento de uso');
  });

  it('reprocesar un documento listo no duplica los fragmentos (idempotente)', async () => {
    const document = await ingestPdf('Contenido estable para reindexar.');
    const before = await getStatus(document.id);

    expect((await processDocument(document.id, true)).status).toBe(202);
    await settleBackground();

    const after = await getStatus(document.id);
    expect(after.status).toBe('ready');
    expect(after.chunkCount).toBe(before.chunkCount);
    const rows = await getDb().select().from(documentChunks).where(eq(documentChunks.documentId, document.id));
    expect(rows).toHaveLength(before.chunkCount);
  });
});

describe('archivos inválidos', () => {
  it('rechaza una extensión no permitida con 415 antes de emitir la URL', async () => {
    const res = await call('POST', '/documents', { fileName: 'virus.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: { code: 'unsupported_media_type' } });
  });

  it('rechaza un MIME que no coincide con la extensión', async () => {
    const res = await call('POST', '/documents', { fileName: 'a.pdf', mimeType: DOCX, sizeBytes: 100 });
    expect(res.status).toBe(415);
  });

  it('rechaza más de 20 MB con 413', async () => {
    const res = await call('POST', '/documents', { fileName: 'enorme.pdf', mimeType: PDF, sizeBytes: MAX_FILE_BYTES + 1 });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('rechaza un cuerpo mal formado con 400 y el formato de error de la API', async () => {
    const res = await call('POST', '/documents', { fileName: '', sizeBytes: -1 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('un archivo que dice ser PDF pero no lo es queda failed con motivo y responde 415', async () => {
    const fake = new TextEncoder().encode('<html>esto no es un pdf</html>');
    const document = await upload(fake, 'falso.pdf', PDF);

    const res = await processDocument(document.id);
    expect(res.status).toBe(415);

    expect(await getStatus(document.id)).toMatchObject({
      status: 'failed',
      errorMessage: 'El contenido no corresponde a un archivo PDF o DOCX válido',
    });
  });

  it('un PDF sin texto (escaneado) queda failed con el motivo del spec', async () => {
    const document = await upload(makePdf(['', '']), 'escaneado.pdf', PDF);
    expect((await processDocument(document.id)).status).toBe(202);
    await settleBackground();

    expect(await getStatus(document.id)).toMatchObject({ status: 'failed', errorMessage: NO_TEXT_MESSAGE, chunkCount: 0 });
  });

  it('procesar un documento cuyo archivo no se subió responde 404 y no cambia su estado', async () => {
    const res = await call('POST', '/documents', { fileName: 'fantasma.pdf', mimeType: PDF, sizeBytes: 100 });
    const { document } = (await res.json()) as { document: DocumentJson };
    createdDocumentIds.push(document.id);

    expect((await processDocument(document.id)).status).toBe(404);
    expect((await getStatus(document.id)).status).toBe('pending');
  });

  it('un documento que falló se puede reintentar', async () => {
    const document = await upload(makePdf(['', '']), 'reintento.pdf', PDF);
    await processDocument(document.id);
    await settleBackground();
    expect((await getStatus(document.id)).status).toBe('failed');

    // Se corrige el archivo (reemplazo) y se reintenta.
    const replace = await call('POST', `/documents/${document.id}/replace`, {
      fileName: 'reintento.pdf',
      mimeType: PDF,
      sizeBytes: makePdf(['Ahora si tiene texto.']).length,
    });
    expect(replace.status).toBe(200);
    const { upload: signed } = (await replace.json()) as { upload: { path: string; token: string } };
    await putToSignedUrl(signed, makePdf(['Ahora si tiene texto.']), PDF);

    expect((await processDocument(document.id)).status).toBe(202);
    await settleBackground();
    expect(await getStatus(document.id)).toMatchObject({ status: 'ready', errorMessage: null });
  });
});

describe('subida directa a Storage con la URL firmada', () => {
  const createSigned = async (fileName: string) => {
    const bytes = makePdf([`Subida directa ${fileName}`]);
    const res = await call('POST', '/documents', { fileName, mimeType: PDF, sizeBytes: bytes.length });
    const { document, upload: signed } = (await res.json()) as {
      document: DocumentJson;
      upload: { path: string; token: string; signedUrl: string };
    };
    createdDocumentIds.push(document.id);
    return { document, signed, bytes };
  };

  it('el navegador puede subir con un PUT multipart (XHR) a signedUrl', async () => {
    const { document, signed, bytes } = await createSigned('multipart.pdf');

    // Es lo mismo que hace supabase-js y lo que replica el panel con XHR para mostrar progreso.
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', new Blob([bytes as BlobSource], { type: PDF }));
    const res = await fetch(signed.signedUrl, { method: 'PUT', body: form, headers: { 'x-upsert': 'true' } });
    expect(res.status).toBe(200);

    expect(await folderObjects(document.id)).toEqual(['multipart.pdf']);
  });

  it('el bucket rechaza un tipo MIME distinto de PDF y DOCX (por eso la UI envía el MIME canónico)', async () => {
    const { document, signed, bytes } = await createSigned('mime-malo.pdf');
    const { error } = await serviceClient()
      .storage.from('documents')
      .uploadToSignedUrl(signed.path, signed.token, new Blob([bytes as BlobSource], { type: 'application/octet-stream' }), {
        contentType: 'application/octet-stream',
      });
    expect(error).not.toBeNull();
    expect(await folderObjects(document.id)).toEqual([]);
  });
});

describe('duplicados', () => {
  it('el mismo archivo responde 409 y con force=true continúa', async () => {
    const bytes = makePdf(['Documento duplicado de prueba, contenido unico 4821.']);
    const first = await upload(bytes, 'original.pdf', PDF, 'Original');
    expect((await processDocument(first.id)).status).toBe(202);
    await settleBackground();

    const second = await upload(bytes, 'copia.pdf', PDF, 'Copia');
    const conflict = await processDocument(second.id);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: 'duplicate_document', message: expect.stringContaining('Original') },
    });
    expect((await getStatus(second.id)).status).toBe('pending');

    expect((await processDocument(second.id, true)).status).toBe(202);
    await settleBackground();
    expect((await getStatus(second.id)).status).toBe('ready');
  });
});

describe('concurrencia y atascos', () => {
  it('un documento en processing responde 409; si lleva más de 10 minutos se puede reintentar', async () => {
    const document = await upload(makePdf(['Texto para probar el atasco del proceso.']), 'atasco.pdf', PDF);
    await getDb().update(documents).set({ status: 'processing', updatedAt: new Date() }).where(eq(documents.id, document.id));

    expect((await processDocument(document.id)).status).toBe(409);
    expect(await getStatus(document.id)).toMatchObject({ status: 'processing', stuck: false });

    await getDb()
      .update(documents)
      .set({ updatedAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(documents.id, document.id));
    expect(await getStatus(document.id)).toMatchObject({ status: 'processing', stuck: true });

    expect((await processDocument(document.id)).status).toBe(202);
    await settleBackground();
    expect((await getStatus(document.id)).status).toBe('ready');
  });
});

describe('editar, reemplazar, descargar, eliminar', () => {
  it('edita título y descripción', async () => {
    const document = await ingestPdf('Documento para editar.');
    const res = await call('PATCH', `/documents/${document.id}`, { title: 'Nuevo título', description: 'Descripción útil' });
    expect(res.status).toBe(200);
    expect(await getStatus(document.id)).toMatchObject({ title: 'Nuevo título', status: 'ready' });

    expect((await call('PATCH', `/documents/${document.id}`, {})).status).toBe(400);
    expect((await call('PATCH', `/documents/00000000-0000-4000-8000-000000000000`, { title: 'x' })).status).toBe(404);
  });

  it('reemplaza el documento conservando su id, reindexa y limpia la versión anterior', async () => {
    const original = await ingestPdf('Version uno del documento sobre horarios.', 'horarios-v1.pdf');
    const oldPath = original.storagePath;
    expect(await folderObjects(original.id)).toEqual(['horarios-v1.pdf']);

    const nextBytes = makePdf(['Version dos con informacion totalmente nueva sobre costos.']);
    const replace = await call('POST', `/documents/${original.id}/replace`, {
      fileName: 'horarios-v2.pdf',
      mimeType: PDF,
      sizeBytes: nextBytes.length,
    });
    expect(replace.status).toBe(200);
    const { document: pending, upload: signed } = (await replace.json()) as {
      document: DocumentJson;
      upload: { path: string; token: string };
    };
    expect(pending).toMatchObject({ id: original.id, status: 'pending', fileName: 'horarios-v2.pdf' });
    expect(pending.storagePath).not.toBe(oldPath);

    await putToSignedUrl(signed, nextBytes, PDF);
    expect((await processDocument(original.id)).status).toBe(202);
    await settleBackground();

    expect(await getStatus(original.id)).toMatchObject({ status: 'ready', id: original.id });
    const rows = await getDb().select().from(documentChunks).where(eq(documentChunks.documentId, original.id));
    expect(rows.map((r) => r.content).join(' ')).toContain('Version dos');
    expect(rows.map((r) => r.content).join(' ')).not.toContain('Version uno');
    expect(await folderObjects(original.id)).toEqual(['horarios-v2.pdf']);
  });

  it('entrega una URL firmada de descarga que funciona', async () => {
    const document = await ingestPdf('Documento descargable.');
    const res = await call('GET', `/documents/${document.id}/download`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; fileName: string; expiresInSeconds: number };
    expect(body.expiresInSeconds).toBe(900);

    const file = await fetch(body.url);
    expect(file.status).toBe(200);
    expect(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  });

  it('no permite descargar un archivo aún no subido', async () => {
    const res = await call('POST', '/documents', { fileName: 'pendiente.pdf', mimeType: PDF, sizeBytes: 10 });
    const { document } = (await res.json()) as { document: DocumentJson };
    createdDocumentIds.push(document.id);
    expect((await call('GET', `/documents/${document.id}/download`)).status).toBe(409);
  });

  it('al eliminar borra el archivo del bucket, la fila y los fragmentos', async () => {
    const document = await ingestPdf('Documento que sera eliminado por completo.');
    expect(await folderObjects(document.id)).toHaveLength(1);
    expect((await getStatus(document.id)).chunkCount).toBeGreaterThan(0);

    expect((await call('DELETE', `/documents/${document.id}`)).status).toBe(204);

    expect(await folderObjects(document.id)).toEqual([]);
    expect(await getDb().select().from(documents).where(eq(documents.id, document.id))).toEqual([]);
    expect(await getDb().select().from(documentChunks).where(eq(documentChunks.documentId, document.id))).toEqual([]);
    expect((await call('DELETE', `/documents/${document.id}`)).status).toBe(404);
  });
});

describe('seguridad: la clave pública no accede a nada', () => {
  it('no puede leer tablas ni objetos de Storage aunque existan', async () => {
    const document = await ingestPdf('Documento privado que la clave publica no debe ver.');
    const anon = anonClient();

    const table = await anon.from('documents').select('id');
    expect(table.error?.code).toBe('42501');
    expect((await anon.from('document_chunks').select('id')).error?.code).toBe('42501');
    expect((await anon.from('profiles').select('id')).error?.code).toBe('42501');
    expect((await anon.from('conversations').select('id')).error?.code).toBe('42501');

    // Con el objeto realmente presente, anon no lo lista ni lo descarga.
    expect(await folderObjects(document.id)).toHaveLength(1);
    const listed = await anon.storage.from('documents').list(document.id);
    expect(listed.data ?? []).toEqual([]);
    const download = await anon.storage.from('documents').download(document.storagePath);
    expect(download.error).not.toBeNull();
    expect(download.data).toBeNull();
  });

  it('un JWT válido sin fila en profiles recibe 403 en la API', async () => {
    const ghost = await createTestUser('staff');
    try {
      await getDb().execute(`delete from public.profiles where id = '${ghost.id}'`);
      const res = await call('GET', '/documents', undefined, ghost.cookie);
      expect(res.status).toBe(403);
    } finally {
      await ghost.remove();
    }
  });
});
