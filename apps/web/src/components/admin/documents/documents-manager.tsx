'use client';

import { FileText, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { api, unwrap } from '@/lib/api';
import type { DocumentRow } from '@/lib/documents';
import { EmptyState } from '../empty-state';
import { ErrorAlert } from '../error-alert';
import { PageHeader } from '../page-header';
import { DeleteDocumentDialog, DuplicateDialog, EditDocumentDialog } from './document-dialogs';
import { DocumentsTable } from './documents-table';
import { UploadDropzone } from './upload-dropzone';
import { UploadList } from './upload-list';
import { useDocuments } from './use-documents';
import { useUploads } from './use-uploads';

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : 'Ocurrió un error inesperado');

export function DocumentsManager() {
  const { documents, error, loading, refresh } = useDocuments();
  const uploads = useUploads(refresh);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);

  async function download(document: DocumentRow) {
    try {
      const { url } = await unwrap<{ url: string }>(
        await api.api.admin.documents[':id'].download.$get({ param: { id: document.id } }),
      );
      window.location.assign(url);
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  }

  async function save(id: string, values: { title: string; description: string | null }) {
    try {
      await unwrap(await api.api.admin.documents[':id'].$patch({ param: { id }, json: values }));
      toast.success('Documento actualizado');
      await refresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
      throw cause;
    }
  }

  async function reprocess(document: DocumentRow) {
    try {
      if (await uploads.process(document.id, document.fileName)) {
        toast.success(`«${document.title}» se está procesando`);
      }
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      await refresh();
    }
  }

  async function remove(document: DocumentRow) {
    try {
      const response = await api.api.admin.documents[':id'].$delete({ param: { id: document.id } });
      if (!response.ok) await unwrap(response);
      toast.success('Documento eliminado');
      await refresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
      throw cause;
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        icon={FileText}
        title="Documentos"
        description="El asistente responde únicamente con lo que dicen estos documentos."
      />

      <UploadDropzone onFiles={uploads.startMany} />
      <UploadList items={uploads.items} onDismiss={uploads.remove} />

      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Cargando documentos">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {error && documents === null && <ErrorAlert message={error} onRetry={() => void refresh()} />}

      {documents?.length === 0 && (
        <EmptyState icon={FolderOpen}>
          Aún no hay documentos. Sube el primero para que el asistente tenga qué responder.
        </EmptyState>
      )}

      {documents && documents.length > 0 && (
        <DocumentsTable
          documents={documents}
          onDownload={download}
          onEdit={setEditing}
          onReplace={(document, file) => void uploads.start(file, { replaceId: document.id })}
          onReprocess={reprocess}
          onDelete={setDeleting}
        />
      )}

      <EditDocumentDialog document={editing} onClose={() => setEditing(null)} onSave={save} />
      <DeleteDocumentDialog document={deleting} onClose={() => setDeleting(null)} onConfirm={remove} />
      <DuplicateDialog prompt={uploads.duplicate} onContinue={uploads.confirmDuplicate} onCancel={uploads.cancelDuplicate} />
    </div>
  );
}
