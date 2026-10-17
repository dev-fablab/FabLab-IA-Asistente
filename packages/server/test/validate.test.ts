import { describe, expect, it } from 'vitest';
import {
  FILE_KINDS,
  hasValidSignature,
  kindFromFileName,
  MAX_FILE_BYTES,
  sanitizeFileName,
  validateUploadRequest,
} from '../src/ingest/validate';
import { makeDocx, makePdf, makeZipWithoutDocument } from './fixtures';

const PDF = FILE_KINDS.pdf.mimeType;
const DOCX = FILE_KINDS.docx.mimeType;

describe('sanitizeFileName', () => {
  it.each([
    ['guia de servicios.pdf', 'guia de servicios.pdf'],
    ['Guía de Servicios (v2).docx', 'Guía de Servicios (v2).docx'],
    ['../../etc/passwd.pdf', 'passwd.pdf'],
    ['C:\\Users\\yo\\informe.pdf', 'informe.pdf'],
    ['con\u0000nul\u0007.pdf', 'connul.pdf'],
    ['.oculto.pdf', 'oculto.pdf'],
    ['raro<>:"|?*.pdf', 'raro_______.pdf'],
    ['MAYUS.PDF', 'MAYUS.pdf'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('recorta nombres largos conservando la extensión', () => {
    const name = sanitizeFileName(`${'a'.repeat(300)}.docx`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.docx')).toBe(true);
  });

  it('usa un nombre por defecto si no queda nada', () => {
    expect(sanitizeFileName('....pdf')).toBe('documento.pdf');
    expect(sanitizeFileName('///')).toBe('documento');
  });
});

describe('kindFromFileName', () => {
  it('reconoce solo pdf y docx', () => {
    expect(kindFromFileName('a.pdf')).toBe('pdf');
    expect(kindFromFileName('a.DOCX')).toBe('docx');
    expect(kindFromFileName('a.doc')).toBeNull();
    expect(kindFromFileName('a.exe')).toBeNull();
    expect(kindFromFileName('sin-extension')).toBeNull();
  });
});

describe('validateUploadRequest', () => {
  const ok = { fileName: 'guia.pdf', mimeType: PDF, sizeBytes: 1024 };

  it('acepta un PDF y un DOCX válidos', () => {
    expect(validateUploadRequest(ok)).toEqual({ kind: 'pdf', fileName: 'guia.pdf', mimeType: PDF });
    expect(validateUploadRequest({ fileName: 'a.docx', mimeType: DOCX, sizeBytes: 5 }).kind).toBe('docx');
  });

  it('sanea el nombre antes de usarlo', () => {
    expect(validateUploadRequest({ ...ok, fileName: '../x/guia.pdf' }).fileName).toBe('guia.pdf');
  });

  it('rechaza otro tipo con 415', () => {
    expect(() => validateUploadRequest({ ...ok, fileName: 'virus.exe' })).toThrow(/pdf y \.docx/);
    expect(() => validateUploadRequest({ ...ok, fileName: 'viejo.doc' })).toThrow(/pdf y \.docx/);
    try {
      validateUploadRequest({ ...ok, fileName: 'virus.exe' });
    } catch (error) {
      expect(error).toMatchObject({ status: 415, code: 'unsupported_media_type' });
    }
  });

  it('rechaza un MIME que no coincide con la extensión', () => {
    expect(() => validateUploadRequest({ ...ok, mimeType: DOCX })).toThrow(/no coincide/);
    expect(() => validateUploadRequest({ ...ok, mimeType: 'text/html' })).toThrow(/no coincide/);
  });

  it('rechaza archivos vacíos', () => {
    expect(() => validateUploadRequest({ ...ok, sizeBytes: 0 })).toThrow(/vacío/);
  });

  it('acepta exactamente 20 MB y rechaza más con 413', () => {
    expect(validateUploadRequest({ ...ok, sizeBytes: MAX_FILE_BYTES }).kind).toBe('pdf');
    try {
      validateUploadRequest({ ...ok, sizeBytes: MAX_FILE_BYTES + 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ status: 413, code: 'payload_too_large' });
    }
  });
});

describe('hasValidSignature', () => {
  it('acepta un PDF y un DOCX reales', async () => {
    expect(hasValidSignature(makePdf(['hola']), 'pdf')).toBe(true);
    expect(hasValidSignature(await makeDocx(['hola']), 'docx')).toBe(true);
  });

  it('rechaza contenido que no coincide con el tipo declarado', async () => {
    expect(hasValidSignature(makePdf(['hola']), 'docx')).toBe(false);
    expect(hasValidSignature(await makeDocx(['hola']), 'pdf')).toBe(false);
  });

  it('rechaza un ZIP sin word/document.xml', async () => {
    expect(hasValidSignature(await makeZipWithoutDocument(), 'docx')).toBe(false);
  });

  it('rechaza texto o ejecutables disfrazados', () => {
    expect(hasValidSignature(new TextEncoder().encode('<html>no soy un pdf</html>'), 'pdf')).toBe(false);
    expect(hasValidSignature(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), 'pdf')).toBe(false);
    expect(hasValidSignature(new Uint8Array(), 'pdf')).toBe(false);
  });

  it('tolera hasta 1 KB previo a %PDF- pero no más', () => {
    const withPreamble = new Uint8Array([...new Uint8Array(100), ...makePdf(['x'])]);
    expect(hasValidSignature(withPreamble, 'pdf')).toBe(true);
    const tooLate = new Uint8Array([...new Uint8Array(2000), ...makePdf(['x'])]);
    expect(hasValidSignature(tooLate, 'pdf')).toBe(false);
  });
});
