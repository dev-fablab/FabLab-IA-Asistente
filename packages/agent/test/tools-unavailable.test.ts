import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { bookMeeting, contactExists, getAvailability, getDb, listActiveContactChannels } from '@fablab/db';

type DbModule = {
  getDb: typeof getDb;
  listActiveContactChannels: typeof listActiveContactChannels;
  getAvailability: typeof getAvailability;
  contactExists: typeof contactExists;
  bookMeeting: typeof bookMeeting;
};

// Se simulan las dependencias para forzar cada falla técnica.
const mocks = vi.hoisted(() => ({
  embedQuery: vi.fn(),
  listActiveContactChannels: vi.fn(),
  getDb: vi.fn(),
  getAvailability: vi.fn(),
  contactExists: vi.fn(),
  bookMeeting: vi.fn(),
}));

vi.mock('../src/embeddings', () => ({ embedQuery: mocks.embedQuery, embedDocuments: vi.fn() }));
vi.mock('@fablab/db', async (importOriginal) => ({
  ...(await importOriginal<DbModule>()),
  getDb: mocks.getDb,
  listActiveContactChannels: mocks.listActiveContactChannels,
  getAvailability: mocks.getAvailability,
  contactExists: mocks.contactExists,
  bookMeeting: mocks.bookMeeting,
}));

import { getContactInfo } from '../src/tools/get-contact-info';
import { getAvailableSlots } from '../src/tools/get-available-slots';
import { getDocumentLink } from '../src/tools/get-document-link';
import { scheduleMeeting } from '../src/tools/schedule-meeting';
import { searchDocuments } from '../src/tools/search-documents';

const run = (tool: { execute?: (input: never, context: never) => unknown }, input: object) =>
  tool.execute!(input as never, {} as never) as Promise<Record<string, unknown>>;

let errors: string[];
const KEYS = ['NVIDIA_API_KEY', 'RETRIEVAL_MIN_SCORE', 'RETRIEVAL_TOP_K'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.NVIDIA_API_KEY = 'nvapi-clave-secreta-de-prueba';
  vi.clearAllMocks();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    errors.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('searchDocuments cuando la búsqueda falla', () => {
  it('si fallan los embeddings (NVIDIA respondió 410 Gone) devuelve `unavailable` en lugar de lanzar', async () => {
    mocks.embedQuery.mockRejectedValue(new Error('Gone'));

    const result = await run(searchDocuments, { query: '¿Qué servicios ofrece Fab Lab?' });

    expect(result).toEqual({ found: false, passages: [], unavailable: true });
  });

  it('si falla la base de datos también devuelve `unavailable`', async () => {
    mocks.embedQuery.mockResolvedValue([0.1, 0.2]);
    mocks.getDb.mockImplementation(() => {
      throw new Error('connection refused');
    });

    expect(await run(searchDocuments, { query: 'servicios del laboratorio' })).toEqual({ found: false, passages: [], unavailable: true });
  });

  it('una configuración incompleta no rompe el turno', async () => {
    delete process.env.RETRIEVAL_MIN_SCORE; // valores por defecto: no es la causa, pero basta con que algo lance
    mocks.embedQuery.mockRejectedValue(new Error('Configuración incompleta para los embeddings'));
    expect((await run(searchDocuments, { query: 'cualquier pregunta' })).unavailable).toBe(true);
  });

  it('registra el fallo para quien opera el servidor, sin filtrar la clave', async () => {
    mocks.embedQuery.mockRejectedValue(new Error('Gone'));
    await run(searchDocuments, { query: '¿Qué es Fab Lab?' });

    expect(errors).toHaveLength(1);
    const entry = JSON.parse(errors[0]!);
    expect(entry).toMatchObject({ level: 'error', event: 'tool.failed', tool: 'searchDocuments', error: { name: 'Error', message: 'Gone' } });
    expect(errors[0]).not.toContain('nvapi-clave-secreta-de-prueba');
  });

  it('cuando funciona no agrega `unavailable`', async () => {
    mocks.embedQuery.mockResolvedValue([0.1, 0.2]);
    mocks.getDb.mockReturnValue({
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) }),
    });

    const result = await run(searchDocuments, { query: 'pregunta sin respaldo' });
    expect(result).toEqual({ found: false, passages: [] });
    expect(result).not.toHaveProperty('unavailable');
    expect(errors).toEqual([]);
  });
});

describe('getContactInfo cuando falla la base de datos', () => {
  it('devuelve `unavailable`, que es distinto de «no hay canales cargados»', async () => {
    mocks.listActiveContactChannels.mockRejectedValue(new Error('timeout'));
    expect(await run(getContactInfo, {})).toEqual({ channels: [], unavailable: true });
    expect(JSON.parse(errors[0]!)).toMatchObject({ tool: 'getContactInfo', error: { message: 'timeout' } });
  });

  it('sin canales pero sin falla devuelve una lista vacía sin `unavailable`', async () => {
    mocks.listActiveContactChannels.mockResolvedValue([]);
    expect(await run(getContactInfo, {})).toEqual({ channels: [] });
  });
});

describe('getDocumentLink cuando falla', () => {
  it('devuelve `unavailable` si falla la consulta o la firma del enlace', async () => {
    mocks.getDb.mockImplementation(() => {
      throw new Error('connection refused');
    });
    expect(await run(getDocumentLink, { query: 'guía de servicios' })).toEqual({ matches: [], unavailable: true });
    expect(JSON.parse(errors[0]!)).toMatchObject({ tool: 'getDocumentLink' });
  });
});

describe('getAvailableSlots cuando falla', () => {
  it('devuelve `unavailable`, que es distinto de «no hay horarios libres»', async () => {
    mocks.getAvailability.mockRejectedValue(new Error('connection refused'));
    expect(await run(getAvailableSlots, {})).toEqual({ timeZone: '', durationMinutes: 0, days: [], unavailable: true });
    expect(JSON.parse(errors[0]!)).toMatchObject({ tool: 'getAvailableSlots' });
  });
});

describe('scheduleMeeting cuando falla', () => {
  const input = { name: 'Ana', email: 'ana@correo.cl', reason: 'Visita', startsAt: '2026-10-26T14:00:00.000Z' };

  it('si falla la consulta del contacto no agenda nada y devuelve `unavailable`', async () => {
    mocks.contactExists.mockRejectedValue(new Error('timeout'));
    expect(await run(scheduleMeeting, input)).toEqual({ status: 'unavailable', unavailable: true });
    expect(mocks.bookMeeting).not.toHaveBeenCalled();
  });

  it('si falla la reserva devuelve `unavailable` y no filtra los datos de la persona al registro', async () => {
    mocks.contactExists.mockResolvedValue(false);
    mocks.bookMeeting.mockRejectedValue(new Error('connection refused'));
    expect(await run(scheduleMeeting, input)).toEqual({ status: 'unavailable', unavailable: true });
    expect(JSON.parse(errors[0]!)).toMatchObject({ tool: 'scheduleMeeting' });
    expect(errors[0]).not.toContain('ana@correo.cl');
  });

  it('si el horario se ocupa y también falla la búsqueda de alternativas, avisa en vez de lanzar', async () => {
    mocks.contactExists.mockResolvedValue(true);
    mocks.bookMeeting.mockResolvedValue({ status: 'slot_unavailable' });
    mocks.getAvailability.mockRejectedValue(new Error('timeout'));
    expect(await run(scheduleMeeting, input)).toEqual({ status: 'unavailable', unavailable: true });
  });
});
