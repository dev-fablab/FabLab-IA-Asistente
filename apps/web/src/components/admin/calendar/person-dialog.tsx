'use client';

import { Plus, Save, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, unwrap } from '@/lib/api';
import { isSource, SOURCE_LABELS, SOURCES, type ContactSource, type Person, type PersonDetail } from '@/lib/calendar';
import { CHANNEL_TYPES, isChannelType, TYPE_LABELS, VALUE_HINTS, type ChannelType } from '@/lib/contact';
import { CHANNEL_ICONS } from '../contact/channel-type';
import { SOURCE_ICONS } from './source-badge';

/** Cuántos medios de contacto adicionales admite una persona (el mismo tope de la API). */
const MAX_METHODS = 10;

type Row = { type: ChannelType; value: string };

type Props = {
  /** `null` cierra el diálogo; una persona existente la edita y `'new'` registra una. */
  target: Person | 'new' | null;
  onClose: () => void;
  /** Se guardó: devuelve la persona con lo que quedó registrado. */
  onSaved: (detail: PersonDetail, created: boolean) => void;
};

function Form({ target, onClose, onSaved }: Props & { target: Person | 'new' }) {
  const existing = target === 'new' ? null : target;
  const [source, setSource] = useState<ContactSource>(existing && isSource(existing.source) ? existing.source : 'in_person');
  const [methods, setMethods] = useState<Row[]>(() => (existing?.methods ?? []).map((method) => ({ type: isChannelType(method.type) ? method.type : 'phone', value: method.value })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateRow = (index: number, patch: Partial<Row>) => setMethods((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get('name') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      source,
      // Una fila a medias (sin valor) se ignora en vez de bloquear el guardado.
      methods: methods.map((row) => ({ type: row.type, value: row.value.trim() })).filter((row) => row.value),
    };
    setSaving(true);
    setError(null);
    try {
      const detail = existing
        ? await unwrap<PersonDetail>(await api.api.admin.calendar.people[':id'].$patch({ param: { id: existing.id }, json: body }))
        : await unwrap<PersonDetail>(await api.api.admin.calendar.people.$post({ json: body }));
      onSaved(detail, !existing);
      onClose();
    } catch (cause) {
      // El mensaje de la API explica qué falló: correo repetido, formato del teléfono, etc.
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar a la persona');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{existing ? 'Editar persona' : 'Agregar persona'}</DialogTitle>
        <DialogDescription>
          Quien se relaciona con Fab Lab. El nombre y el correo son obligatorios; el correo es con el que el asistente la reconoce cuando agenda.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="person-name">Nombre</Label>
        <Input id="person-name" name="name" defaultValue={existing?.name} maxLength={120} required autoFocus placeholder="Ej.: Camila Rojas" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="person-email">Correo</Label>
        <Input id="person-email" name="email" type="email" defaultValue={existing?.email} maxLength={254} required placeholder="Ej.: camila@correo.cl" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="person-source">Medio por el que llegó</Label>
        <Select value={source} onValueChange={(next) => isSource(next) && setSource(next)}>
          <SelectTrigger id="person-source" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCES.map((option) => {
              const Icon = SOURCE_ICONS[option];
              return (
                <SelectItem key={option} value={option}>
                  <Icon aria-hidden /> {SOURCE_LABELS[option]}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Otros medios de contacto (opcional)</legend>
        <p className="text-xs text-muted-foreground">Teléfono, WhatsApp, redes... otras formas de ubicar a la persona además del correo.</p>
        {methods.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select value={row.type} onValueChange={(next) => isChannelType(next) && updateRow(index, { type: next })}>
              <SelectTrigger className="w-40 shrink-0" aria-label={`Tipo del medio ${index + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_TYPES.map((type) => {
                  const Icon = CHANNEL_ICONS[type];
                  return (
                    <SelectItem key={type} value={type}>
                      <Icon aria-hidden /> {TYPE_LABELS[type]}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Input
              value={row.value}
              onChange={(event) => updateRow(index, { value: event.target.value })}
              maxLength={500}
              placeholder={VALUE_HINTS[row.type]}
              aria-label={`Valor del medio ${index + 1}`}
            />
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setMethods((rows) => rows.filter((_, i) => i !== index))} aria-label={`Quitar el medio ${index + 1}`}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        {methods.length < MAX_METHODS && (
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setMethods((rows) => [...rows, { type: 'phone', value: '' }])}>
            <Plus aria-hidden /> Agregar medio de contacto
          </Button>
        )}
      </fieldset>

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

/** Crear o editar a una persona (la registra el equipo; el asistente las crea solo al agendar por el chat). */
export function PersonDialog(props: Props) {
  const { target, onClose } = props;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {/* El formulario se monta al abrir: así cada vez parte del estado de la persona elegida. */}
        {target !== null && <Form key={target === 'new' ? 'new' : target.id} {...props} target={target} />}
      </DialogContent>
    </Dialog>
  );
}
