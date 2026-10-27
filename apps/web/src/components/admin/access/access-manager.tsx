'use client';

import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, unwrap } from '@/lib/api';
import { EmptyState } from '../empty-state';
import { ErrorAlert } from '../error-alert';
import { PageHeader } from '../page-header';

type Role = 'admin' | 'staff';

type AccessUser = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
};

type Draft = {
  email: string;
  role: Role;
  password: string;
};

const SEED_EMAILS = new Set(['admin@inacapmail.cl', 'staff@inacapmail.cl']);
const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', staff: 'Personal' };

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : 'Ocurrió un error inesperado');
const isSeed = (email: string) => SEED_EMAILS.has(email.trim().toLowerCase());

const emptyDraft = (): Draft => ({ email: '', role: 'staff', password: '' });

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-CL', { dateStyle: 'medium' });
}

/** Vincular, editar y quitar accesos del panel. Solo lo usa quien tiene rol admin. */
export function AccessManager() {
  const [loaded, setLoaded] = useState<{ users?: AccessUser[]; error?: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<AccessUser | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AccessUser | null>(null);

  useEffect(() => {
    let ignore = false;
    api.api.admin.users
      .$get()
      .then((response) => unwrap<{ users: AccessUser[] }>(response))
      .then(({ users }) => {
        if (!ignore) setLoaded({ users });
      })
      .catch((cause: unknown) => {
        if (!ignore) setLoaded({ error: messageOf(cause) });
      });
    return () => {
      ignore = true;
    };
  }, [reload]);

  const refresh = () => setReload((n) => n + 1);
  const users = loaded?.users;

  async function save(draft: Draft, existing: AccessUser | null) {
    const password = draft.password.trim();
    const response = existing
      ? await api.api.admin.users[':id'].$patch({
          param: { id: existing.id },
          json: { email: draft.email, role: draft.role, ...(password ? { password } : {}) },
        })
      : await api.api.admin.users.$post({
          json: { email: draft.email, role: draft.role, password },
        });
    await unwrap(response);
    toast.success(existing ? 'Acceso actualizado' : 'Acceso vinculado');
    refresh();
  }

  async function remove(user: AccessUser) {
    const response = await api.api.admin.users[':id'].$delete({ param: { id: user.id } });
    if (!response.ok) await unwrap(response);
    toast.success('Acceso eliminado');
    refresh();
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        icon={KeyRound}
        title="Accesos"
        description="Correos @inacapmail.cl que pueden entrar al panel, con su contraseña y su rol."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Vincular acceso
          </Button>
        }
      />

      {!loaded && (
        <div className="flex flex-col gap-2" role="status" aria-label="Cargando accesos">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {loaded?.error && <ErrorAlert message={loaded.error} onRetry={refresh} />}

      {users?.length === 0 && (
        <EmptyState icon={KeyRound}>Aún no hay accesos. Vincula un correo @inacapmail.cl para que alguien entre al panel.</EmptyState>
      )}

      {users && users.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{ROLE_LABEL[user.role]}</TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${user.email}`} onClick={() => setEditing(user)}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Eliminar ${user.email}`}
                        disabled={isSeed(user.email)}
                        onClick={() => setDeleting(user)}
                      >
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

      <AccessDialog target={editing} onClose={() => setEditing(null)} onSave={save} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 shrink-0 text-destructive" aria-hidden /> ¿Quitar el acceso de {deleting?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>La persona ya no podrá entrar al panel. Los documentos y reuniones que haya creado se conservan.</AlertDialogDescription>
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

function AccessDialog({
  target,
  onClose,
  onSave,
}: {
  target: AccessUser | 'new' | null;
  onClose: () => void;
  onSave: (draft: Draft, existing: AccessUser | null) => Promise<void>;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {target && <AccessForm target={target} onClose={onClose} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function AccessForm({
  target,
  onClose,
  onSave,
}: {
  target: AccessUser | 'new';
  onClose: () => void;
  onSave: (draft: Draft, existing: AccessUser | null) => Promise<void>;
}) {
  const existing = target === 'new' ? null : target;
  const lockedEmail = existing ? isSeed(existing.email) : false;
  const [draft, setDraft] = useState<Draft>(
    existing ? { email: existing.email, role: existing.role, password: '' } : emptyDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSave(draft, existing);
      onClose();
    } catch (cause) {
      setError(messageOf(cause));
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{existing ? 'Editar acceso' : 'Vincular acceso'}</DialogTitle>
        <DialogDescription>
          {existing
            ? 'Puedes cambiar el rol y, si escribes una contraseña nueva, reemplaza la anterior.'
            : 'El correo debe ser @inacapmail.cl. La contraseña se guarda como un hash y no se puede leer después.'}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="access-email">Correo</Label>
        <Input
          id="access-email"
          type="email"
          autoComplete="off"
          required
          disabled={lockedEmail}
          value={draft.email}
          onChange={(event) => setDraft({ ...draft, email: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="access-role">Rol</Label>
        <Select value={draft.role} onValueChange={(value) => setDraft({ ...draft, role: value as Role })}>
          <SelectTrigger id="access-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="staff">Personal</SelectItem>
            <SelectItem value="admin">Administrador</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="access-password">{existing ? 'Nueva contraseña' : 'Contraseña'}</Label>
        <Input
          id="access-password"
          type="password"
          autoComplete="new-password"
          required={!existing}
          minLength={existing ? undefined : 12}
          placeholder={existing ? 'En blanco conserva la actual' : 'Mínimo 12 caracteres'}
          value={draft.password}
          onChange={(event) => setDraft({ ...draft, password: event.target.value })}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </DialogFooter>
    </form>
  );
}
