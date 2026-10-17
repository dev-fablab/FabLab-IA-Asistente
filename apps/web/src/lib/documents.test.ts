import { describe, expect, it } from 'vitest';
import { canonicalMimeType, formatBytes, MAX_FILE_BYTES, titleFromFileName, validateFile } from './documents';

const file = (name: string, size = 1024) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateFile', () => {
  it('acepta .pdf y .docx', () => {
    expect(validateFile(file('guia.pdf'))).toBeNull();
    expect(validateFile(file('guia.DOCX'))).toBeNull();
  });

  it('rechaza otros tipos con el motivo', () => {
    expect(validateFile(file('foto.png'))).toBe('Solo se aceptan archivos .pdf y .docx');
    expect(validateFile(file('viejo.doc'))).toBe('Solo se aceptan archivos .pdf y .docx');
    expect(validateFile(file('sin-extension'))).toBe('Solo se aceptan archivos .pdf y .docx');
  });

  it('rechaza archivos vacíos y de más de 20 MB, pero acepta exactamente 20 MB', () => {
    expect(validateFile(file('a.pdf', 0))).toBe('El archivo está vacío');
    expect(validateFile(file('a.pdf', MAX_FILE_BYTES + 1))).toBe('El archivo supera el máximo de 20 MB');
    expect(validateFile(file('a.pdf', MAX_FILE_BYTES))).toBeNull();
  });
});

describe('canonicalMimeType', () => {
  it('devuelve el MIME según la extensión, sin fiarse del que reporta el navegador', () => {
    expect(canonicalMimeType('a.pdf')).toBe('application/pdf');
    expect(canonicalMimeType('a.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(canonicalMimeType('a.exe')).toBeUndefined();
  });
});

describe('titleFromFileName', () => {
  it('propone un título legible', () => {
    expect(titleFromFileName('guia_de_servicios.pdf')).toBe('guia de servicios');
    expect(titleFromFileName('Reglamento v2.docx')).toBe('Reglamento v2');
  });
});

describe('formatBytes', () => {
  it('usa B, KB y MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB');
  });
});
