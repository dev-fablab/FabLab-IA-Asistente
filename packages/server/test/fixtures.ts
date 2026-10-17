import JSZip from 'jszip';

/** Escapa un texto para una cadena literal de PDF; las tildes pasan a octal (WinAnsi). */
function pdfString(text: string): string {
  const latin1 = (char: string) => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`;
  return text.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[\u0080-ÿ]/g, latin1);
}

/**
 * PDF mínimo y válido con una página por elemento. Una cadena vacía produce una página sin
 * texto, como un PDF escaneado.
 */
export function makePdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((text, index) => {
    const content = text ? `BT /F1 12 Tf 72 720 Td (${pdfString(text)}) Tj ET` : '';
    objects[4 + index * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + index * 2} 0 R ` +
      '/Resources << /Font << /F1 3 0 R >> >> >>';
    objects[5 + index * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefStart = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body, 'latin1'));
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** DOCX mínimo y válido con un párrafo por elemento. */
export async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join('') +
      '</w:body></w:document>',
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** Un ZIP válido que no es un DOCX (le falta `word/document.xml`). */
export async function makeZipWithoutDocument(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('leeme.txt', 'no soy un documento de Word');
  return zip.generateAsync({ type: 'uint8array' });
}
