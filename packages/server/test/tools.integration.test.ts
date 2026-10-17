import { getDocumentLink, searchDocuments } from '@fablab/agent';
import { documentChunks, documents, EMBEDDING_DIMENSIONS, getDb } from '@fablab/db';
import { inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makePdf } from './fixtures';
import { serviceClient } from './helpers/integration';

const DIMENSIONS = EMBEDDING_DIMENSIONS;
const BASIS = 'BASIS-QUERY';

/** Vector unitario con la similitud coseno indicada respecto a la consulta (el primer eje). */
function vectorWithSimilarity(similarity: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[0] = similarity;
  vector[1] = Math.sqrt(1 - similarity * similarity);
  return vector;
}

// La consulta `BASIS-QUERY` es el primer eje: la similitud de cada fragmento es la que se le asigne.
vi.mock('@fablab/agent/embeddings', () => ({
  embedDocuments: async (texts: string[]) => texts.map(() => vectorWithSimilarity(1)),
  embedQuery: async (text: string) => {
    if (text !== BASIS) throw new Error('la prueba usa solo la consulta BASIS-QUERY');
    return vectorWithSimilarity(1);
  },
}));

const TAG = `tl-${Math.random().toString(36).slice(2, 8)}`;
const documentIds: string[] = [];
const objectPaths: string[] = [];

async function addDocument(
  options: { title?: string; fileName?: string; description?: string; status?: 'ready' | 'processing' | 'failed' | 'pending'; upload?: boolean } = {},
) {
  const id = crypto.randomUUID();
  const fileName = options.fileName ?? `${TAG}-${id.slice(0, 6)}.pdf`;
  const storagePath = `${id}/${fileName}`;
  const bytes = makePdf(['x']);

  if (options.upload) {
    const { error } = await serviceClient()
      .storage.from('documents')
      .upload(storagePath, new Blob([bytes as never], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    expect(error).toBeNull();
    objectPaths.push(storagePath);
  }

  await getDb()
    .insert(documents)
    .values({
      id,
      title: options.title ?? `${TAG} documento ${id.slice(0, 6)}`,
      description: options.description ?? null,
      fileName,
      storagePath,
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      status: options.status ?? 'ready',
    });
  documentIds.push(id);
  return id;
}

async function addChunk(documentId: string, similarity: number, content: string, page: number | null = 1) {
  await getDb()
    .insert(documentChunks)
    .values({ documentId, chunkIndex: 0, page, content, embedding: vectorWithSimilarity(similarity) });
}

const search = async () => (await searchDocuments.execute!({ query: BASIS }, {} as never)) as {
  found: boolean;
  passages: { text: string; title: string; page: number | null; score: number }[];
};

const link = async (query: string) =>
  (await getDocumentLink.execute!({ query }, {} as never)) as { matches: { title: string; url: string; fileName: string }[] };

beforeAll(() => {
  process.env.NVIDIA_API_KEY ||= 'test-key-not-used';
  process.env.EMBEDDING_MODEL ||= 'test/embedding';
});

// Cada prueba parte de una base sin documentos de pruebas anteriores.
afterEach(async () => {
  const db = getDb();
  if (documentIds.length) await db.delete(documents).where(inArray(documents.id, documentIds));
  documentIds.length = 0;
  process.env.RETRIEVAL_MIN_SCORE = '0.70';
  process.env.RETRIEVAL_TOP_K = '5';
});

afterAll(async () => {
  if (objectPaths.length) await serviceClient().storage.from('documents').remove(objectPaths);
});

describe('searchDocuments', () => {
  it('devuelve fragmentos sobre el umbral con título, página y puntaje', async () => {
    const id = await addDocument({ title: `${TAG} Guía de servicios` });
    await addChunk(id, 0.9, 'Servicios de impresión 3D', 4);

    const result = await search();
    const mine = result.passages.filter((p) => p.title.startsWith(TAG));
    expect(result.found).toBe(true);
    expect(mine).toEqual([{ text: 'Servicios de impresión 3D', title: `${TAG} Guía de servicios`, page: 4, score: 0.9 }]);
  });

  it('un fragmento bajo el umbral no se devuelve: found:false', async () => {
    const id = await addDocument();
    await addChunk(id, 0.5, 'Contenido poco relacionado');

    expect((await search()).passages.filter((p) => p.text === 'Contenido poco relacionado')).toEqual([]);
  });

  it('el umbral se lee de RETRIEVAL_MIN_SCORE', async () => {
    const id = await addDocument();
    await addChunk(id, 0.8, 'Fragmento intermedio');

    process.env.RETRIEVAL_MIN_SCORE = '0.7';
    expect((await search()).passages.some((p) => p.text === 'Fragmento intermedio')).toBe(true);
    process.env.RETRIEVAL_MIN_SCORE = '0.85';
    expect((await search()).passages.some((p) => p.text === 'Fragmento intermedio')).toBe(false);
  });

  it('solo consulta documentos ready', async () => {
    for (const status of ['processing', 'failed', 'pending'] as const) {
      const id = await addDocument({ status });
      await addChunk(id, 0.99, `Contenido de un documento ${status}`);
    }
    const readyId = await addDocument({ status: 'ready' });
    await addChunk(readyId, 0.95, 'Contenido de un documento ready');

    const texts = (await search()).passages.map((p) => p.text);
    expect(texts).toContain('Contenido de un documento ready');
    expect(texts.filter((t) => t.startsWith('Contenido de un documento') && t !== 'Contenido de un documento ready')).toEqual([]);
  });

  it('devuelve como máximo topK fragmentos, del más al menos parecido', async () => {
    const id = await addDocument();
    const similarities = [0.72, 0.99, 0.85, 0.78, 0.91, 0.75, 0.96, 0.88];
    for (const [index, similarity] of similarities.entries()) {
      await getDb()
        .insert(documentChunks)
        .values({ documentId: id, chunkIndex: index, page: index + 1, content: `fragmento-${similarity}`, embedding: vectorWithSimilarity(similarity) });
    }

    const { passages } = await search();
    const mine = passages.filter((p) => p.text.startsWith('fragmento-'));
    expect(mine.map((p) => p.score)).toEqual([0.99, 0.96, 0.91, 0.88, 0.85]);

    process.env.RETRIEVAL_TOP_K = '2';
    expect((await search()).passages.filter((p) => p.text.startsWith('fragmento-')).map((p) => p.score)).toEqual([0.99, 0.96]);
  });

  it('un documento eliminado deja de aportar fragmentos (borrado en cascada)', async () => {
    const id = await addDocument();
    await addChunk(id, 0.97, 'Contenido que será eliminado');
    expect((await search()).passages.some((p) => p.text === 'Contenido que será eliminado')).toBe(true);

    await getDb().delete(documents).where(inArray(documents.id, [id]));
    expect((await search()).passages.some((p) => p.text === 'Contenido que será eliminado')).toBe(false);
  });
});

describe('getDocumentLink', () => {
  it('encuentra por título, nombre de archivo y descripción, y firma la URL', async () => {
    const byTitle = await addDocument({ title: `${TAG} Reglamento de uso`, upload: true });
    const byFile = await addDocument({ fileName: `${TAG}-manual-seguridad.pdf`, upload: true });
    const byDescription = await addDocument({ description: `${TAG} protocolo de emergencias`, upload: true });

    // El documento que mejor coincide va primero (el TAG también aparece en los otros dos).
    expect((await link(`${TAG} Reglamento`)).matches[0]?.title).toBe(`${TAG} Reglamento de uso`);
    expect((await link('manual-seguridad')).matches).toHaveLength(1);
    expect((await link('protocolo de emergencias')).matches).toHaveLength(1);

    const [match] = (await link(`${TAG} Reglamento`)).matches;
    const file = await fetch(match!.url);
    expect(file.status).toBe(200);
    expect(byTitle && byFile && byDescription).toBeTruthy();
  });

  it('solo devuelve documentos ready', async () => {
    await addDocument({ title: `${TAG} Borrador interno`, status: 'processing', upload: true });
    await addDocument({ title: `${TAG} Borrador fallido`, status: 'failed', upload: true });
    expect((await link(`${TAG} Borrador`)).matches).toEqual([]);
  });

  it('devuelve hasta 3 coincidencias', async () => {
    for (let i = 0; i < 5; i++) await addDocument({ title: `${TAG} Informe ${i}`, upload: true });
    expect((await link(`${TAG} Informe`)).matches).toHaveLength(3);
  });

  it('% y _ se tratan como texto, no como comodines', async () => {
    await addDocument({ title: `${TAG} Guía general`, upload: true });
    expect((await link('%%')).matches).toEqual([]);
    expect((await link('__')).matches).toEqual([]);
    expect((await link('%%%%')).matches).toEqual([]);

    // Un % literal sí coincide con un título que lo contiene.
    await addDocument({ title: `${TAG} Descuento 50%`, upload: true });
    expect((await link('50%')).matches.map((m) => m.title)).toEqual([`${TAG} Descuento 50%`]);
  });

  it('la entrada se valida contra el esquema: una consulta de 1 carácter no se ejecuta', async () => {
    const result = (await getDocumentLink.execute!({ query: '%' }, {} as never)) as { error?: boolean; matches?: unknown };
    expect(result.matches).toBeUndefined();
    expect(result.error).toBe(true);
  });

  it('ordena por relevancia: un título que coincide mejor gana a coincidencias sueltas más recientes', async () => {
    const exact = await addDocument({ title: `${TAG} Reglamento de laboratorio`, upload: true });
    // Más recientes, pero solo comparten una palabra.
    for (let i = 0; i < 4; i++) await addDocument({ title: `${TAG} Laboratorio ${i} otros temas`, upload: true });

    const { matches } = await link(`${TAG} Reglamento de laboratorio`);
    expect(matches[0]?.title).toBe(`${TAG} Reglamento de laboratorio`);
    expect(matches).toHaveLength(3);
    expect(exact).toBeTruthy();
  });

  it('las palabras genéricas de la petición no traen documentos al azar', async () => {
    await addDocument({ title: `${TAG} Documento de seguridad`, upload: true });
    await addDocument({ title: `${TAG} Documento de costos`, upload: true });
    // «dame el documento» no identifica ninguno: sin palabras significativas no hay coincidencias.
    expect((await link('dame el documento')).matches).toEqual([]);
  });

  it('sin coincidencias devuelve una lista vacía', async () => {
    expect(await link('documento-que-no-existe-xyz')).toEqual({ matches: [] });
  });
});
