'use client';

import { Download, FileText, FileType, MoreHorizontal, Pencil, RefreshCw, Replace, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDate, type DocumentRow } from '@/lib/documents';
import { StatusBadge } from './status-badge';

type Props = {
  documents: DocumentRow[];
  onDownload: (document: DocumentRow) => void;
  onEdit: (document: DocumentRow) => void;
  onReplace: (document: DocumentRow, file: File) => void;
  onReprocess: (document: DocumentRow) => void;
  onDelete: (document: DocumentRow) => void;
};

/**
 * Acciones disponibles por estado (spec §5): `ready` permite todo; `failed` o atascado,
 * reintentar, reemplazar y eliminar; `processing` y `pending`, solo esperar o eliminar.
 */
function actionsFor(document: DocumentRow) {
  const retryable = document.status === 'failed' || document.stuck;
  return {
    download: document.status === 'ready',
    edit: document.status === 'ready',
    replace: document.status === 'ready' || retryable,
    reprocess: document.status === 'ready' || retryable,
    reprocessLabel: document.status === 'ready' ? 'Reindexar' : 'Reintentar',
    remove: document.status !== 'processing' || document.stuck,
  };
}

/** El PDF lleva el rojo de la marca; el Word, un tono neutro: se distinguen de un vistazo. */
function FileKindIcon({ fileName }: { fileName: string }) {
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const Icon = isPdf ? FileText : FileType;
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${isPdf ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

export function DocumentsTable({ documents, onDownload, onEdit, onReplace, onReprocess, onDelete }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<DocumentRow | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Archivo</TableHead>
              <TableHead className="text-right">Tamaño</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Fragmentos</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => {
              const actions = actionsFor(document);
              const hasActions = actions.download || actions.edit || actions.replace || actions.reprocess || actions.remove;

              return (
                <TableRow key={document.id}>
                  <TableCell className="max-w-64 font-medium">
                    <div className="flex items-center gap-3">
                      <FileKindIcon fileName={document.fileName} />
                      <span className="block truncate" title={document.title}>
                        {document.title}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-56 text-muted-foreground">
                    <span className="block truncate" title={document.fileName}>
                      {document.fileName}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatBytes(document.sizeBytes)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(document.createdAt)}</TableCell>
                  <TableCell className="max-w-72">
                    <StatusBadge document={document} />
                    {document.status === 'failed' && document.errorMessage && (
                      <p className="mt-1 text-xs text-destructive">{document.errorMessage}</p>
                    )}
                    {document.stuck && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Lleva más de 10 minutos procesándose; puedes reintentarlo.
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{document.status === 'ready' ? document.chunkCount : '—'}</TableCell>
                  <TableCell>
                    {hasActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${document.title}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {actions.download && (
                            <DropdownMenuItem onSelect={() => onDownload(document)}>
                              <Download /> Descargar
                            </DropdownMenuItem>
                          )}
                          {actions.edit && (
                            <DropdownMenuItem onSelect={() => onEdit(document)}>
                              <Pencil /> Editar título y descripción
                            </DropdownMenuItem>
                          )}
                          {actions.replace && (
                            <DropdownMenuItem
                              onSelect={() => {
                                setReplacing(document);
                                fileInput.current?.click();
                              }}
                            >
                              <Replace /> Reemplazar archivo
                            </DropdownMenuItem>
                          )}
                          {actions.reprocess && (
                            <DropdownMenuItem onSelect={() => onReprocess(document)}>
                              <RefreshCw /> {actions.reprocessLabel}
                            </DropdownMenuItem>
                          )}
                          {actions.remove && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(document)}>
                                <Trash2 /> Eliminar
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Un solo selector de archivo para el reemplazo; la fila elegida queda en `replacing`. */}
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        aria-label="Seleccionar el archivo de reemplazo"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && replacing) onReplace(replacing, file);
          setReplacing(null);
          event.target.value = '';
        }}
      />
    </>
  );
}
