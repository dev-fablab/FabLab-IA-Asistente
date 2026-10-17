import { act, renderHook, waitFor } from '@testing-library/react';
import type * as ApiModule from '@/lib/api';
import type * as DocumentsModule from '@/lib/documents';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_BYTES } from '@/lib/documents';
import { useUploads } from './use-uploads';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  replace: vi.fn(),
  process: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('@/lib/api');
  return {
    ...actual,
    api: {
      api: {
        admin: {
          documents: {
            $post: mocks.create,
            ':id': {
              replace: { $post: mocks.replace },
              process: { $post: mocks.process },
              $delete: mocks.remove,
            },
          },
        },
      },
    },
  };
});

vi.mock('@/lib/documents', async () => {
  const actual = await vi.importActual<typeof DocumentsModule>('@/lib/documents');
  return { ...actual, uploadToSignedUrl: mocks.upload };
});

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const registered = (id = 'doc-1') => ({
  document: { id },
  upload: { path: `${id}/guia.pdf`, token: 't', signedUrl: 'http://storage.test/upload' },
});

const pdf = (name = 'guia.pdf', size = 2048) => {
  const file = new File(['%PDF-'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

function setup() {
  const onChange = vi.fn(async () => undefined);
  const hook = renderHook(() => useUploads(onChange));
  return { ...hook, onChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue(undefined);
});

describe('useUploads: validación previa', () => {
  it('un archivo de otro tipo se rechaza antes de subir, con el motivo en su fila', async () => {
    const { result } = setup();
    await act(() => result.current.start(new File(['x'], 'foto.png')));

    expect(result.current.items).toMatchObject([
      { fileName: 'foto.png', phase: 'error', error: 'Solo se aceptan archivos .pdf y .docx' },
    ]);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('un archivo de más de 20 MB se rechaza antes de subir', async () => {
    const { result } = setup();
    await act(() => result.current.start(pdf('enorme.pdf', MAX_FILE_BYTES + 1)));

    expect(result.current.items[0]).toMatchObject({ phase: 'error', error: 'El archivo supera el máximo de 20 MB' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('con varios archivos, los válidos siguen aunque otro sea rechazado', async () => {
    mocks.create.mockResolvedValue(json(registered(), 201));
    mocks.process.mockResolvedValue(json({ document: {} }, 202));
    const { result } = setup();

    act(() => result.current.startMany([new File(['x'], 'malo.exe'), pdf('bueno.pdf')]));
    await waitFor(() => expect(mocks.process).toHaveBeenCalledTimes(1));

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(result.current.items.map((i) => i.fileName)).toContain('malo.exe');
  });
});

describe('useUploads: flujo exitoso', () => {
  it('registra, sube con el MIME canónico y procesa; la fila desaparece', async () => {
    mocks.create.mockResolvedValue(json(registered('doc-7'), 201));
    mocks.process.mockResolvedValue(json({ document: { id: 'doc-7' } }, 202));
    const { result, onChange } = setup();

    await act(() => result.current.start(pdf('Guía_de_servicios.pdf')));

    expect(mocks.create).toHaveBeenCalledWith({
      json: {
        fileName: 'Guía_de_servicios.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        title: 'Guía de servicios',
      },
    });
    expect(mocks.upload).toHaveBeenCalledWith('http://storage.test/upload', expect.any(File), expect.any(Function));
    expect(mocks.process).toHaveBeenCalledWith({ param: { id: 'doc-7' }, query: {} });
    expect(result.current.items).toEqual([]);
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('informa el progreso de la subida', async () => {
    mocks.create.mockResolvedValue(json(registered(), 201));
    mocks.process.mockResolvedValue(json({ document: {} }, 202));
    let reportProgress: (percent: number) => void = () => undefined;
    let finishUpload: () => void = () => undefined;
    mocks.upload.mockImplementation(
      (_url: string, _file: File, onProgress: (percent: number) => void) =>
        new Promise<void>((resolve) => {
          reportProgress = onProgress;
          finishUpload = resolve;
        }),
    );
    const { result } = setup();

    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.start(pdf());
    });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());

    act(() => reportProgress(40));
    expect(result.current.items[0]).toMatchObject({ phase: 'uploading', progress: 40 });

    await act(async () => {
      finishUpload();
      await started;
    });
    expect(result.current.items).toEqual([]);
  });

  it('el reemplazo usa la ruta replace del documento existente', async () => {
    mocks.replace.mockResolvedValue(json(registered('doc-9')));
    mocks.process.mockResolvedValue(json({ document: {} }, 202));
    const { result } = setup();

    await act(() => result.current.start(pdf('v2.pdf'), { replaceId: 'doc-9' }));

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith({
      param: { id: 'doc-9' },
      json: { fileName: 'v2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
    });
    expect(mocks.process).toHaveBeenCalledWith({ param: { id: 'doc-9' }, query: {} });
  });
});

describe('useUploads: errores', () => {
  it('si falla la subida muestra el motivo y no procesa', async () => {
    mocks.create.mockResolvedValue(json(registered(), 201));
    mocks.upload.mockRejectedValue(new Error('Se perdió la conexión al subir el archivo'));
    const { result } = setup();

    await act(() => result.current.start(pdf()));

    expect(result.current.items[0]).toMatchObject({ phase: 'error', error: 'Se perdió la conexión al subir el archivo' });
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('si el servidor rechaza el registro muestra el mensaje de la API', async () => {
    mocks.create.mockResolvedValue(json({ error: { code: 'unsupported_media_type', message: 'El tipo del archivo no coincide con su extensión' } }, 415));
    const { result } = setup();

    await act(() => result.current.start(pdf()));

    expect(result.current.items[0]).toMatchObject({
      phase: 'error',
      error: 'El tipo del archivo no coincide con su extensión',
    });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('un 409 que no es duplicado se muestra como error, sin diálogo', async () => {
    mocks.create.mockResolvedValue(json(registered(), 201));
    mocks.process.mockResolvedValue(json({ error: { code: 'conflict', message: 'El documento ya se está procesando' } }, 409));
    const { result } = setup();

    await act(() => result.current.start(pdf()));

    expect(result.current.duplicate).toBeNull();
    expect(result.current.items[0]).toMatchObject({ phase: 'error', error: 'El documento ya se está procesando' });
  });
});

describe('useUploads: duplicados', () => {
  const duplicateResponse = () =>
    json({ error: { code: 'duplicate_document', message: 'Este archivo ya está cargado como «Guía»' } }, 409);

  it('un duplicado pide confirmación y no deja una fila de error', async () => {
    mocks.create.mockResolvedValue(json(registered('doc-2'), 201));
    mocks.process.mockResolvedValue(duplicateResponse());
    const { result } = setup();

    await act(() => result.current.start(pdf()));

    expect(result.current.duplicate).toEqual({
      documentId: 'doc-2',
      fileName: 'guia.pdf',
      message: 'Este archivo ya está cargado como «Guía»',
    });
    expect(result.current.items).toEqual([]);
  });

  it('continuar de todos modos procesa con force=true', async () => {
    mocks.create.mockResolvedValue(json(registered('doc-2'), 201));
    mocks.process.mockResolvedValueOnce(duplicateResponse()).mockResolvedValueOnce(json({ document: {} }, 202));
    const { result } = setup();
    await act(() => result.current.start(pdf()));

    await act(() => result.current.confirmDuplicate());

    expect(mocks.process).toHaveBeenLastCalledWith({ param: { id: 'doc-2' }, query: { force: 'true' } });
    expect(result.current.duplicate).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('cancelar elimina el registro que quedó pendiente', async () => {
    mocks.create.mockResolvedValue(json(registered('doc-2'), 201));
    mocks.process.mockResolvedValue(duplicateResponse());
    mocks.remove.mockResolvedValue(new Response(null, { status: 204 }));
    const { result } = setup();
    await act(() => result.current.start(pdf()));

    await act(() => result.current.cancelDuplicate());

    expect(mocks.remove).toHaveBeenCalledWith({ param: { id: 'doc-2' } });
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(result.current.duplicate).toBeNull();
  });
});
