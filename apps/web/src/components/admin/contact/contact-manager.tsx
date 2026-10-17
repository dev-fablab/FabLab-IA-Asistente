'use client';

import { ContactRound, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, unwrap } from '@/lib/api';
import type { ContactChannelRow } from '@/lib/contact';
import { EmptyState } from '../empty-state';
import { ErrorAlert } from '../error-alert';
import { PageHeader } from '../page-header';
import { ChannelDialog, type ChannelValues } from './channel-dialog';
import { ChannelTypeBadge } from './channel-type';

type Loaded = { channels?: ContactChannelRow[]; error?: string };

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : 'Ocurrió un error inesperado');

/** Canales oficiales de contacto (RF-18): lista editable con tipo, etiqueta, valor, notas, estado y orden. */
export function ContactManager() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<ContactChannelRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ContactChannelRow | null>(null);

  useEffect(() => {
    let ignore = false;
    api.api.admin['contact-channels']
      .$get()
      .then((response) => unwrap<{ channels: ContactChannelRow[] }>(response))
      .then(({ channels }) => {
        if (!ignore) setLoaded({ channels });
      })
      .catch((cause: unknown) => {
        if (!ignore) setLoaded({ error: messageOf(cause) });
      });
    return () => {
      ignore = true;
    };
  }, [reload]);

  const refresh = () => setReload((n) => n + 1);
  const channels = loaded?.channels;
  const nextSortOrder = channels && channels.length > 0 ? Math.max(...channels.map((c) => c.sortOrder)) + 1 : 0;

  async function save(values: ChannelValues, existing: ContactChannelRow | null) {
    const response = existing
      ? await api.api.admin['contact-channels'][':id'].$patch({ param: { id: existing.id }, json: values })
      : await api.api.admin['contact-channels'].$post({ json: values });
    await unwrap(response);
    toast.success(existing ? 'Canal actualizado' : 'Canal agregado');
    refresh();
  }

  async function toggleActive(channel: ContactChannelRow, isActive: boolean) {
    try {
      await unwrap(await api.api.admin['contact-channels'][':id'].$patch({ param: { id: channel.id }, json: { isActive } }));
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      refresh();
    }
  }

  async function remove(channel: ContactChannelRow) {
    const response = await api.api.admin['contact-channels'][':id'].$delete({ param: { id: channel.id } });
    if (!response.ok) await unwrap(response);
    toast.success('Canal eliminado');
    refresh();
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        icon={Phone}
        title="Contacto"
        description="Canales oficiales que el asistente entrega cuando no tiene la información o alguien quiere agendar. Solo los activos los ve el asistente."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Agregar canal
          </Button>
        }
      />

      {!loaded && (
        <div className="flex flex-col gap-2" role="status" aria-label="Cargando canales">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {loaded?.error && <ErrorAlert message={loaded.error} onRetry={refresh} />}

      {channels?.length === 0 && (
        <EmptyState icon={ContactRound}>
          Aún no hay canales de contacto. Sin ellos, el asistente no podrá derivar a las personas al equipo.
        </EmptyState>
      )}

      {channels && channels.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">Orden</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Etiqueta</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((channel) => (
                <TableRow key={channel.id} className={channel.isActive ? undefined : 'text-muted-foreground'}>
                  <TableCell className="text-right tabular-nums">{channel.sortOrder}</TableCell>
                  <TableCell>
                    <ChannelTypeBadge type={channel.type} />
                  </TableCell>
                  <TableCell className="font-medium">{channel.label}</TableCell>
                  <TableCell className="max-w-64 break-words whitespace-normal">{channel.value}</TableCell>
                  <TableCell className="max-w-56 whitespace-normal">{channel.notes}</TableCell>
                  <TableCell>
                    <Switch
                      checked={channel.isActive}
                      onCheckedChange={(checked) => void toggleActive(channel, checked)}
                      aria-label={`${channel.isActive ? 'Desactivar' : 'Activar'} ${channel.label}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${channel.label}`} onClick={() => setEditing(channel)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Eliminar ${channel.label}`} onClick={() => setDeleting(channel)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ChannelDialog target={editing} nextSortOrder={nextSortOrder} onClose={() => setEditing(null)} onSave={save} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 shrink-0 text-destructive" aria-hidden /> ¿Eliminar «{deleting?.label}»?
            </AlertDialogTitle>
            <AlertDialogDescription>El asistente dejará de entregar este canal. Si solo quieres ocultarlo por un tiempo, desactívalo en lugar de eliminarlo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await remove(deleting);
                } catch (cause) {
                  toast.error(messageOf(cause));
                }
              }}
            >
              <Trash2 aria-hidden /> Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
