import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRow } from '@/lib/documents';
import { DocumentsTable } from './documents-table';

const base: DocumentRow = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Guía de servicios',
  description: null,
  fileName: 'guia.pdf',
  storagePath: 'x/guia.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  contentHash: 'abc',
  status: 'ready',
  errorMessage: null,
  chunkCount: 12,
  uploadedBy: null,
  createdAt: '2026-10-17T10:00:00.000Z',
  updatedAt: '2026-10-17T10:00:00.000Z',
  stuck: false,
};

function renderTable(document: DocumentRow) {
  return render(
    <DocumentsTable
      documents={[document]}
      onDownload={vi.fn()}
      onEdit={vi.fn()}
      onReplace={vi.fn()}
      onReprocess={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

/** Abre el menú de la fila: Radix marca el resto de la página como aria-hidden mientras está abierto. */
async function openMenu(document: DocumentRow) {
  renderTable(document);
  const trigger = screen.queryByRole('button', { name: `Acciones de ${document.title}` });
  if (trigger) await userEvent.setup().click(trigger);
}

const menuLabels = () => screen.queryAllByRole('menuitem').map((item) => item.textContent?.trim());

describe('DocumentsTable: columnas', () => {
  it('muestra título, archivo, tamaño, fecha, estado y fragmentos', () => {
    renderTable(base);
    expect(screen.getByText('Guía de servicios')).toBeInTheDocument();
    expect(screen.getByText('guia.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('Listo')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    for (const header of ['Título', 'Archivo', 'Tamaño', 'Fecha', 'Estado', 'Fragmentos']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('un documento fallido muestra su motivo', () => {
    renderTable({ ...base, status: 'failed', errorMessage: 'El archivo no contiene texto; el OCR no está incluido en la Fase 1', chunkCount: 0 });
    expect(screen.getByText('Falló')).toBeInTheDocument();
    expect(screen.getByText(/no contiene texto/)).toBeInTheDocument();
  });
});

describe('DocumentsTable: acciones por estado', () => {
  it('ready: descargar, editar, reemplazar, reindexar y eliminar', async () => {
    await openMenu(base);
    expect(menuLabels()).toEqual([
      'Descargar',
      'Editar título y descripción',
      'Reemplazar archivo',
      'Reindexar',
      'Eliminar',
    ]);
  });

  it('failed: reintentar, reemplazar y eliminar', async () => {
    await openMenu({ ...base, status: 'failed', errorMessage: 'x' });
    expect(menuLabels()).toEqual(['Reemplazar archivo', 'Reintentar', 'Eliminar']);
  });

  it('pending: solo eliminar', async () => {
    await openMenu({ ...base, status: 'pending' });
    expect(menuLabels()).toEqual(['Eliminar']);
  });

  it('processing: solo esperar (sin menú de acciones)', () => {
    renderTable({ ...base, status: 'processing' });
    expect(screen.queryByRole('button', { name: /Acciones de/ })).not.toBeInTheDocument();
    expect(screen.getByText('Procesando')).toBeInTheDocument();
  });

  it('processing atascado: se ofrece reintentar y eliminar y se explica el motivo', async () => {
    renderTable({ ...base, status: 'processing', stuck: true });
    expect(screen.getByText('Atascado')).toBeInTheDocument();
    expect(screen.getByText(/más de 10 minutos/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Acciones de/ }));
    expect(menuLabels()).toEqual(['Reemplazar archivo', 'Reintentar', 'Eliminar']);
  });

  it('cada acción llama a su manejador con el documento', async () => {
    const handlers = { onDownload: vi.fn(), onEdit: vi.fn(), onReplace: vi.fn(), onReprocess: vi.fn(), onDelete: vi.fn() };
    const user = userEvent.setup();
    render(<DocumentsTable documents={[base]} {...handlers} />);

    const open = () => user.click(screen.getByRole('button', { name: 'Acciones de Guía de servicios' }));
    await open();
    await user.click(screen.getByRole('menuitem', { name: /Descargar/ }));
    await open();
    await user.click(screen.getByRole('menuitem', { name: /Editar/ }));
    await open();
    await user.click(screen.getByRole('menuitem', { name: /Reindexar/ }));
    await open();
    await user.click(screen.getByRole('menuitem', { name: /Eliminar/ }));

    expect(handlers.onDownload).toHaveBeenCalledWith(base);
    expect(handlers.onEdit).toHaveBeenCalledWith(base);
    expect(handlers.onReprocess).toHaveBeenCalledWith(base);
    expect(handlers.onDelete).toHaveBeenCalledWith(base);
  });
});
