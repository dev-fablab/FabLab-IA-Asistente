'use client';

import { Copy, Pencil, Save, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DocumentRow } from '@/lib/documents';
import type { DuplicatePrompt } from './use-uploads';

type EditProps = {
  document: DocumentRow | null;
  onClose: () => void;
  onSave: (id: string, values: { title: string; description: string | null }) => Promise<void>;
};

/** Edita título y descripción, que se usan al citar la fuente (RF-16). */
export function EditDocumentDialog({ document, onClose, onSave }: EditProps) {
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    if (!title) return;

    setSaving(true);
    try {
      await onSave(document.id, { title, description: description || null });
      onClose();
    } catch {
      // El error ya se mostró; el diálogo queda abierto para reintentar.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {document && (
          // `key` reinicia el formulario al abrir otro documento.
          <form key={document.id} onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="size-4 text-primary" aria-hidden /> Editar documento
              </DialogTitle>
              <DialogDescription>
                El asistente usa el título y la descripción al citar la fuente de una respuesta.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="doc-title">Título</Label>
              <Input id="doc-title" name="title" defaultValue={document.title} maxLength={200} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="doc-description">Descripción (opcional)</Label>
              <Textarea id="doc-description" name="description" defaultValue={document.description ?? ''} maxLength={2000} rows={4} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                <Save aria-hidden /> {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type DeleteProps = {
  document: DocumentRow | null;
  onClose: () => void;
  onConfirm: (document: DocumentRow) => Promise<void>;
};

/** Pide confirmación y explica el efecto: el asistente deja de conocer ese contenido. */
export function DeleteDocumentDialog({ document, onClose, onConfirm }: DeleteProps) {
  const [deleting, setDeleting] = useState(false);

  return (
    <AlertDialog open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="size-4 shrink-0 text-destructive" aria-hidden /> ¿Eliminar «{document?.title}»?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Se borrarán el archivo y su contenido indexado. El asistente dejará de conocer esta información y no se
            puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={async (event) => {
              event.preventDefault();
              if (!document) return;
              setDeleting(true);
              try {
                await onConfirm(document);
                onClose();
              } catch {
                // El error ya se mostró; el diálogo queda abierto para reintentar.
              } finally {
                setDeleting(false);
              }
            }}
          >
            <Trash2 aria-hidden /> {deleting ? 'Eliminando…' : 'Eliminar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type DuplicateProps = {
  prompt: DuplicatePrompt | null;
  onContinue: () => void;
  onCancel: () => void;
};

/** El mismo archivo ya está cargado: se ofrece continuar de todos modos (409 con opción de continuar). */
export function DuplicateDialog({ prompt, onContinue, onCancel }: DuplicateProps) {
  return (
    <AlertDialog open={prompt !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Copy className="size-4 text-warning" aria-hidden /> Archivo duplicado
          </AlertDialogTitle>
          <AlertDialogDescription>
            {prompt?.message}. ¿Quieres cargarlo de todos modos? El asistente tendría el mismo contenido dos veces.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>No cargarlo</AlertDialogCancel>
          <AlertDialogAction onClick={onContinue}>Cargar de todos modos</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
