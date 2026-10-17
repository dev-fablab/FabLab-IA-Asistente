import { describe, expect, it } from 'vitest';
import { CHUNK_OPTIONS, chunkPages } from '../src/ingest/chunk';
import { NO_TEXT_MESSAGE } from '../src/ingest/errors';
import { cleanText, extractPages } from '../src/ingest/extract';
import { makeDocx, makePdf } from './fixtures';

describe('cleanText', () => {
  it('quita NUL y caracteres de control que Postgres no admite', () => {
    expect(cleanText('ho\u0000la\u0007 mundo')).toBe('hola mundo');
  });

  it('normaliza saltos de línea y colapsa líneas en blanco', () => {
    expect(cleanText('a\r\nb\r\n\r\n\r\n\r\nc  \nd')).toBe('a\nb\n\nc\nd');
  });
});

describe('extractPages', () => {
  it('extrae el texto de un PDF conservando el número de página', async () => {
    const pdf = makePdf(['Que es Fab Lab', 'Servicios de fabricacion digital']);
    const pages = await extractPages(pdf, 'pdf');

    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ page: 1 });
    expect(pages[0]!.text).toContain('Fab Lab');
    expect(pages[1]).toMatchObject({ page: 2 });
    expect(pages[1]!.text).toContain('fabricacion digital');
  });

  it('conserva las tildes de un PDF en español', async () => {
    const [page] = await extractPages(makePdf(['Impresión 3D y corte láser']), 'pdf');
    expect(page!.text).toContain('Impresión 3D');
    expect(page!.text).toContain('láser');
  });

  it('descarta las páginas sin texto pero conserva la numeración de las demás', async () => {
    const pages = await extractPages(makePdf(['primera', '', 'tercera']), 'pdf');
    expect(pages.map((p) => p.page)).toEqual([1, 3]);
  });

  it('extrae el texto de un DOCX sin número de página', async () => {
    const docx = await makeDocx(['Fab Lab es un laboratorio', 'Ofrece impresión 3D']);
    const pages = await extractPages(docx, 'docx');

    expect(pages).toHaveLength(1);
    expect(pages[0]!.page).toBeNull();
    expect(pages[0]!.text).toContain('Fab Lab es un laboratorio');
    expect(pages[0]!.text).toContain('impresión 3D');
  });

  it('un PDF sin texto (escaneado) falla con el motivo del spec', async () => {
    await expect(extractPages(makePdf(['', '']), 'pdf')).rejects.toThrow(NO_TEXT_MESSAGE);
  });

  it('un DOCX vacío falla con el mismo motivo', async () => {
    await expect(extractPages(await makeDocx([]), 'docx')).rejects.toThrow(NO_TEXT_MESSAGE);
  });

  it('un archivo dañado falla con un mensaje legible, sin filtrar el error interno', async () => {
    const corrupt = new TextEncoder().encode('%PDF-1.4 esto no es un pdf de verdad');
    await expect(extractPages(corrupt, 'pdf')).rejects.toMatchObject({
      name: 'IngestError',
      message: expect.stringContaining('No se pudo leer el archivo'),
    });
    await expect(extractPages(new Uint8Array([1, 2, 3]), 'docx')).rejects.toMatchObject({ name: 'IngestError' });
  });
});

describe('chunkPages', () => {
  const sentence = 'Fab Lab ofrece servicios de fabricación digital para la comunidad. ';

  it('un texto corto queda en un solo fragmento con su página', async () => {
    const chunks = await chunkPages([{ page: 3, text: 'Texto breve sobre Fab Lab.' }]);
    expect(chunks).toEqual([{ chunkIndex: 0, page: 3, content: 'Texto breve sobre Fab Lab.' }]);
  });

  it('un texto largo se divide en fragmentos que respetan el tamaño máximo', async () => {
    const chunks = await chunkPages([{ page: 1, text: sentence.repeat(40) }]);

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_OPTIONS.maxSize);
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it('los fragmentos contiguos se solapan', async () => {
    const chunks = await chunkPages([{ page: 1, text: sentence.repeat(40) }]);
    const tail = chunks[0]!.content.slice(-20);
    expect(chunks[1]!.content).toContain(tail.trim().split(' ').slice(-2).join(' '));
  });

  it('cada fragmento conserva la página de la que viene y el índice es correlativo', async () => {
    const chunks = await chunkPages([
      { page: 1, text: sentence.repeat(15) },
      { page: null, text: sentence.repeat(15) },
      { page: 7, text: 'Cierre.' },
    ]);

    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, index) => index));
    const pages = [...new Set(chunks.map((c) => c.page))];
    expect(pages).toEqual([1, null, 7]);
    // Ningún fragmento mezcla páginas: los de la página 1 van antes que los de la siguiente.
    expect(chunks.at(-1)).toMatchObject({ page: 7, content: 'Cierre.' });
  });

  it('no genera fragmentos vacíos', async () => {
    expect(await chunkPages([{ page: 1, text: '   \n\n  ' }])).toEqual([]);
  });
});
