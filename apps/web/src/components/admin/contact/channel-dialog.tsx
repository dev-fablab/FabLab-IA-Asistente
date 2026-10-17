'use client';

import { Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CHANNEL_ICONS } from './channel-type';
import {
  CHANNEL_TYPES,
  isChannelType,
  TYPE_LABELS,
  VALUE_HINTS,
  type ChannelType,
  type ContactChannelRow,
} from '@/lib/contact';

export type ChannelValues = {
  type: ChannelType;
  label: string;
  value: string;
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
};

type Props = {
  /** `null` cierra el diálogo; un canal existente lo edita y `'new'` crea uno. */
  target: ContactChannelRow | 'new' | null;
  nextSortOrder: number;
  onClose: () => void;
  /** Guarda el canal. Debe lanzar un `Error` con el motivo si la API lo rechaza. */
  onSave: (values: ChannelValues, existing: ContactChannelRow | null) => Promise<void>;
};

function Form({ target, nextSortOrder, onClose, onSave }: Props & { target: ContactChannelRow | 'new' }) {
  const existing = target === 'new' ? null : target;
  const [type, setType] = useState<ChannelType>(existing && isChannelType(existing.type) ? existing.type : 'phone');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          type,
          label: String(form.get('label') ?? '').trim(),
          value: String(form.get('value') ?? '').trim(),
          notes: String(form.get('notes') ?? '').trim() || null,
          sortOrder: Number(form.get('sortOrder') ?? 0),
          isActive,
        },
        existing,
      );
      onClose();
    } catch (cause) {
      // El mensaje de la API explica qué formato espera el tipo elegido.
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el canal');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{existing ? 'Editar canal de contacto' : 'Agregar canal de contacto'}</DialogTitle>
        <DialogDescription>Solo los canales activos los entrega el asistente cuando alguien necesita contactar al equipo.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="channel-type">Tipo</Label>
        <Select value={type} onValueChange={(next) => isChannelType(next) && setType(next)}>
          <SelectTrigger id="channel-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNEL_TYPES.map((option) => {
              const Icon = CHANNEL_ICONS[option];
              return (
                <SelectItem key={option} value={option}>
                  <Icon aria-hidden /> {TYPE_LABELS[option]}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="channel-label">Etiqueta</Label>
        <Input id="channel-label" name="label" defaultValue={existing?.label} maxLength={100} required placeholder="Ej.: Teléfono de atención" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="channel-value">Valor</Label>
        <Input id="channel-value" name="value" defaultValue={existing?.value} maxLength={500} required placeholder={VALUE_HINTS[type]} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="channel-notes">Notas (opcional)</Label>
        <Textarea id="channel-notes" name="notes" defaultValue={existing?.notes ?? ''} maxLength={500} rows={2} placeholder="Ej.: Lunes a viernes, de 9 a 18 h" />
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="channel-order">Orden</Label>
          <Input id="channel-order" name="sortOrder" type="number" min={0} max={9999} step={1} defaultValue={existing?.sortOrder ?? nextSortOrder} className="w-28" required />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="channel-active" checked={isActive} onCheckedChange={setIsActive} />
          <Label htmlFor="channel-active">Activo</Label>
        </div>
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
        <Button type="submit" disabled={saving}>
          <Save aria-hidden /> {saving ? 'Guardando…' : 'Guardar'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Crea o edita un canal. Se remonta por canal (`key`) para que el formulario no arrastre datos del anterior. */
export function ChannelDialog(props: Props) {
  const { target, onClose } = props;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {target && <Form key={target === 'new' ? 'new' : target.id} {...props} target={target} />}
      </DialogContent>
    </Dialog>
  );
}
