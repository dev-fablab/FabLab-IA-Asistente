'use client';

import { CalendarPlus, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, unwrap } from '@/lib/api';
import { memberName, zonedInstant, type PersonRow, type TeamMember } from '@/lib/calendar';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : 'No se pudo agendar la reunión');

export function ManualMeetingDialog({ open, onOpenChange, onCreated }: Props) {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactId, setContactId] = useState('');
  const [responsibleId, setResponsibleId] = useState('');

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const loadPeople = async () => {
      const first = await unwrap<{ items: PersonRow[]; totalPages: number }>(
        await api.api.admin.calendar.people.$get({ query: { page: '1' } }),
      );
      const remaining = await Promise.all(
        Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
          api.api.admin.calendar.people
            .$get({ query: { page: String(index + 2) } })
            .then((response) => unwrap<{ items: PersonRow[] }>(response)),
        ),
      );
      return [first.items, ...remaining.map((page) => page.items)].flat();
    };
    Promise.all([
      loadPeople(),
      api.api.admin.team.$get().then((response) => unwrap<{ members: TeamMember[] }>(response)),
    ])
      .then(([loadedPeople, { members }]) => {
        if (!ignore) {
          setPeople(loadedPeople);
          setTeam(members);
        }
      })
      .catch((cause: unknown) => {
        if (!ignore) setError(messageOf(cause));
      })
      .finally(() => {
        if (!ignore) setLoadingOptions(false);
      });
    return () => {
      ignore = true;
    };
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (next) {
      setLoadingOptions(true);
      setError(null);
      setPeople([]);
      setTeam([]);
      setContactId('');
      setResponsibleId('');
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get('date') ?? '');
    const time = String(form.get('time') ?? '');
    const startsAt = zonedInstant(date, time);
    const body = {
      contactId,
      responsibleId,
      startsAt: startsAt.toISOString(),
      durationMinutes: Number(form.get('durationMinutes') ?? 60),
      reason: String(form.get('reason') ?? '').trim(),
    };

    setSaving(true);
    setError(null);
    try {
      await unwrap(await api.api.admin.calendar.meetings.$post({ json: body }));
      toast.success('Reunión agendada');
      onCreated();
      onOpenChange(false);
      event.currentTarget.reset();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus aria-hidden /> Agendar reunión
            </DialogTitle>
            <DialogDescription>
              Selecciona un asociado y un responsable existentes. La duración predeterminada es de 60 minutos; el sistema impedirá
              horarios solapados.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="manual-meeting-contact">Asociado</Label>
            <Select value={contactId} onValueChange={setContactId} required disabled={loadingOptions || people.length === 0}>
              <SelectTrigger id="manual-meeting-contact" className="w-full">
                <SelectValue placeholder={loadingOptions ? 'Cargando asociados…' : 'Selecciona un asociado'} />
              </SelectTrigger>
              <SelectContent>
                {people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name} · {person.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="manual-meeting-responsible">Responsable</Label>
            <Select value={responsibleId} onValueChange={setResponsibleId} required disabled={loadingOptions || team.length === 0}>
              <SelectTrigger id="manual-meeting-responsible" className="w-full">
                <SelectValue placeholder={loadingOptions ? 'Cargando equipo…' : 'Selecciona un responsable'} />
              </SelectTrigger>
              <SelectContent>
                {team.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {memberName(member)} · {member.role === 'admin' ? 'Administración' : 'Staff'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="manual-meeting-date">Fecha</Label>
              <Input id="manual-meeting-date" name="date" type="date" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="manual-meeting-time">Hora</Label>
              <Input id="manual-meeting-time" name="time" type="time" required />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="manual-meeting-duration">Duración (minutos)</Label>
            <Input id="manual-meeting-duration" name="durationMinutes" type="number" min={15} max={480} step={15} defaultValue={60} required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="manual-meeting-reason">Motivo</Label>
            <Input id="manual-meeting-reason" name="reason" maxLength={500} required placeholder="Ej.: Revisión de proyecto" />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {people.length === 0 && !loadingOptions && !error && <p className="text-sm text-muted-foreground">Primero debes crear un asociado.</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || loadingOptions || people.length === 0 || team.length === 0 || !contactId || !responsibleId}>
              <Save aria-hidden /> {saving ? 'Agendando…' : 'Agendar reunión'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
