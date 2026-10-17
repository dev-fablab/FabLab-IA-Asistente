import { EMBEDDING_DIMENSIONS } from '@fablab/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embedDocuments, embedQuery, EMBEDDING_BATCH_SIZE } from '../src/embeddings';
import { NVIDIA_NIM_BASE_URL } from '../src/models';

type Captured = { url: string; headers: Headers; body: { model: string; input: string[] } & Record<string, unknown> };

const KEYS = ['NVIDIA_API_KEY', 'EMBEDDING_MODEL', 'EMBEDDING_DIMENSION', 'EMBEDDING_ASYMMETRIC'] as const;
let saved: Record<string, string | undefined>;
let requests: Captured[];

/** Responde como NIM: un vector por texto, con el índice codificado en la primera componente. */
function respondWithVectors(dimensions = EMBEDDING_DIMENSIONS) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = (await request.json()) as Captured['body'];
      requests.push({ url: request.url, headers: request.headers, body });

      const data = body.input.map((text, index) => {
        const embedding = new Array<number>(dimensions).fill(0);
        embedding[0] = Number(text.replace(/\D/g, '') || index); // permite comprobar el orden
        return { object: 'embedding', index, embedding };
      });
      return Response.json({ object: 'list', data, model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } });
    }),
  );
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.NVIDIA_API_KEY = 'nvapi-clave-de-prueba';
  process.env.EMBEDDING_MODEL = 'org/modelo-de-embeddings';
  delete process.env.EMBEDDING_DIMENSION;
  delete process.env.EMBEDDING_ASYMMETRIC;
  requests = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('solicitud a NVIDIA NIM', () => {
  it('llama al endpoint de embeddings de NIM con la clave y el modelo configurados', async () => {
    respondWithVectors();
    await embedDocuments(['Fab Lab ofrece impresión 3D']);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toBe(`${NVIDIA_NIM_BASE_URL}/embeddings`);
    expect(request!.url).toBe('https://integrate.api.nvidia.com/v1/embeddings');
    expect(request!.headers.get('authorization')).toBe('Bearer nvapi-clave-de-prueba');
    // El id va tal cual lo espera NIM (sin el prefijo `nvidia/` del enrutador de Mastra).
    expect(request!.body.model).toBe('org/modelo-de-embeddings');
    expect(request!.body.input).toEqual(['Fab Lab ofrece impresión 3D']);
  });

  it('usa el esquema OpenAI estándar: no agrega campos propios de otros modelos', async () => {
    respondWithVectors();
    await embedDocuments(['texto']);

    // Por defecto el modelo es simétrico. Los modelos de recuperación de NVIDIA exigen `input_type`:
    // se activan con EMBEDDING_ASYMMETRIC=true (ver el bloque siguiente).
    expect(requests[0]!.body).not.toHaveProperty('input_type');
    expect(requests[0]!.body).not.toHaveProperty('dimensions');
    expect(requests[0]!.body.encoding_format).toBe('float');
  });

  it('el modelo sale de EMBEDDING_MODEL, no del código', async () => {
    respondWithVectors();
    process.env.EMBEDDING_MODEL = 'otro/modelo-de-embeddings';
    await embedQuery('hola');
    expect(requests[0]!.body.model).toBe('otro/modelo-de-embeddings');
  });
});

describe('embedDocuments', () => {
  it('manda los fragmentos en lotes de 100 y conserva el orden', async () => {
    respondWithVectors();
    const texts = Array.from({ length: 250 }, (_, i) => `fragmento ${i}`);

    const vectors = await embedDocuments(texts);

    expect(EMBEDDING_BATCH_SIZE).toBe(100);
    expect(requests.map((r) => r.body.input.length)).toEqual([100, 100, 50]);
    expect(vectors).toHaveLength(250);
    expect(vectors.map((v) => v[0])).toEqual(texts.map((_, i) => i));
  });

  it('un texto solo y una lista vacía', async () => {
    respondWithVectors();
    expect(await embedDocuments(['uno'])).toHaveLength(1);
    expect(await embedDocuments([])).toEqual([]);
    expect(requests).toHaveLength(1); // la lista vacía no llama a la API
  });

  it('rechaza vectores de otra dimensión con un mensaje que explica qué revisar', async () => {
    respondWithVectors(1536); // el modelo devuelve 1536 y la columna espera 1024
    await expect(embedDocuments(['texto'])).rejects.toThrow(/1536 dimensiones.*espera 1024.*EMBEDDING_MODEL/s);
  });

  it('un error del proveedor se propaga (la ingesta lo convierte en un motivo legible)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"Unauthorized"}', { status: 401 })));
    await expect(embedDocuments(['texto'])).rejects.toThrow();
  });
});

describe('embedQuery', () => {
  it('devuelve un vector de la dimensión de la columna con una sola llamada', async () => {
    respondWithVectors();
    const vector = await embedQuery('¿Qué servicios ofrece?');

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.input).toEqual(['¿Qué servicios ofrece?']);
  });

  it('rechaza una dimensión distinta', async () => {
    respondWithVectors(768);
    await expect(embedQuery('hola')).rejects.toThrow(/768 dimensiones/);
  });
});

describe('modelos asimétricos de NIM (EMBEDDING_ASYMMETRIC=true)', () => {
  beforeEach(() => {
    process.env.EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2';
    process.env.EMBEDDING_ASYMMETRIC = 'true';
    process.env.EMBEDDING_DIMENSION = String(EMBEDDING_DIMENSIONS);
  });

  it('los documentos se envían como `passage` y se pide la dimensión de la columna', async () => {
    respondWithVectors();
    await embedDocuments(['Fab Lab ofrece impresión 3D']);

    expect(requests[0]!.body).toMatchObject({
      model: 'nvidia/llama-nemotron-embed-vl-1b-v2',
      input: ['Fab Lab ofrece impresión 3D'],
      encoding_format: 'float',
      input_type: 'passage',
      dimensions: EMBEDDING_DIMENSIONS,
    });
  });

  it('las preguntas se envían como `query`', async () => {
    respondWithVectors();
    await embedQuery('¿Qué servicios ofrece?');

    expect(requests[0]!.body).toMatchObject({ input_type: 'query', dimensions: EMBEDDING_DIMENSIONS });
  });

  it('cada lote de documentos lleva `passage`', async () => {
    respondWithVectors();
    await embedDocuments(Array.from({ length: 150 }, (_, i) => `fragmento ${i}`));

    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.body.input_type === 'passage')).toBe(true);
  });

  it('sin EMBEDDING_DIMENSION definida no se le pide un tamaño al modelo', async () => {
    delete process.env.EMBEDDING_DIMENSION;
    respondWithVectors();
    await embedQuery('hola');

    expect(requests[0]!.body.input_type).toBe('query');
    expect(requests[0]!.body).not.toHaveProperty('dimensions');
  });

  it('EMBEDDING_DIMENSION vacía equivale a no definida', async () => {
    process.env.EMBEDDING_DIMENSION = '';
    respondWithVectors();
    await embedQuery('hola');

    expect(requests[0]!.body).not.toHaveProperty('dimensions');
  });

  it('un valor inválido de EMBEDDING_ASYMMETRIC es un error de configuración', async () => {
    process.env.EMBEDDING_ASYMMETRIC = 'quizas';
    await expect(embedQuery('hola')).rejects.toThrow(/EMBEDDING_ASYMMETRIC/);
  });
});
