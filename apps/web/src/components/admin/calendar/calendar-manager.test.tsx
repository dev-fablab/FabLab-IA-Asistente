import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateKey } from '@/lib/calendar';
import { json, mockApi } from '@/test/fetch-mock';
import { CalendarManager } from './calendar-manager';



const ID = '00000000-0000-4000-8000-000000000042';

// Hoy a las 12:00 en Santiago (15:00 UTC en verano, 16:00 en invierno: 15:30Z cae a las 11:30 o 12:30 y siempre dentro de 6 a 22).
const startsAt = new Date(`${dateKey(new Date())}T15:30:00.000Z`);
const endsAt = new Date(startsAt.getTime() + 3_600_000);

const meeting = {
  id: ID,
  startsAt: startsAt.toISOString(),
  endsAt: endsAt.toISOString(),
  status: 'scheduled',
  reason: 'Quiero construir un robot',
  contactName: 'Camila Rojas',
  contactEmail: 'camila@correo.cl',
  responsibleId: null,
  responsibleName: null,
};

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  api = mockApi();
  api.on('GET /api/admin/calendar/meetings', () => json({ items: [meeting] }));
  // Todos los días con atención de 08:00 a 20:00.
  api.on('GET /api/admin/calendar/availability/open-hours', (call) => {
    const days = [];
    for (let date = new Date(`${call.search.get('from')}T12:00:00Z`); date <= new Date(`${call.search.get('to')}T12:00:00Z`); date = new Date(date.getTime() + 86_400_000)) {
      days.push({ date: date.toISOString().slice(0, 10), open: [{ startMinute: 480, endMinute: 1200 }] });
    }
    return json({ days });
  });
  api.on('GET /api/admin/team', () => json({ members: [] }));
  api.on('GET /api/admin/me', () => json({ id: 'p1', email: 'ana@fablab.cl', role: 'staff' }));
  api.on(`GET /api/admin/calendar/meetings/${ID}`, () =>
    json({
      meeting: { ...meeting, conversationSummary: 'Quiere un robot.', conversationId: null, createdAt: meeting.startsAt, contact: { id: 'c1', name: 'Camila Rojas', email: 'camila@correo.cl', source: 'chat', methods: [] } },
      responsible: null,
      minutes: [],
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('CalendarManager', () => {
  it('consulta las reuniones y el horario de atención del rango visible, en español', async () => {
    render(<CalendarManager />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls.some((call) => call.path === '/api/admin/calendar/meetings')).toBe(true));

    const request = api.calls.find((call) => call.path === '/api/admin/calendar/meetings')!;
    const from = new Date(request.search.get('from')!);
    const to = new Date(request.search.get('to')!);
    expect(from < to).toBe(true);
    expect(request.search.get('from')).toMatch(/(Z|[+-]\d{2}:\d{2})$/); // con offset: la API lo acepta
    expect(api.calls.some((call) => call.path === '/api/admin/calendar/availability/open-hours')).toBe(true);

    expect(await screen.findByRole('button', { name: 'Hoy' })).toBeInTheDocument();
    expect(screen.getByText('Semana')).toBeInTheDocument();
  });

  it('muestra la reunión, sombrea las horas sin atención y abre el detalle al hacer clic', async () => {
    const user = userEvent.setup();
    render(<CalendarManager />);

    // El bloque indica quién la pidió y quién la lleva (aquí, nadie todavía).
    const chip = await screen.findByText('Camila Rojas · sin responsable');
    await waitFor(() => expect(document.querySelector('[data-slot="closed-hours"]')).not.toBeNull());

    await user.click(chip);
    const dialog = await screen.findByRole('dialog', { name: 'Reunión con Camila Rojas' });
    expect(within(dialog).getByText('Quiere un robot.')).toBeInTheDocument();
  });

  it('si falla la consulta muestra el error y permite reintentar', async () => {
    let attempts = 0;
    api.on('GET /api/admin/calendar/meetings', () =>
      ++attempts === 1 ? json({ error: { code: 'internal_error', message: 'Base de datos caída' } }, 500) : json({ items: [meeting] }),
    );
    const user = userEvent.setup();
    render(<CalendarManager />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Base de datos caída');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Camila Rojas · sin responsable')).toBeInTheDocument();
  });

  it('muestra al responsable en el bloque y explica el color de las reuniones sin responsable', async () => {
    api.on('GET /api/admin/calendar/meetings', () => json({ items: [{ ...meeting, responsibleId: 'p1', responsibleName: 'Ana Pérez' }] }));
    render(<CalendarManager />);

    expect(await screen.findByText('Camila Rojas · Ana')).toBeInTheDocument();
    expect(screen.getByText(/en amarillo todavía no tienen responsable/)).toBeInTheDocument();
  });

  it('«Disponibilidad» abre el editor del horario semanal', async () => {
    api.on('GET /api/admin/calendar/availability', () =>
      json({
        timeZone: 'America/Santiago',
        durationMinutes: 60,
        rules: [1, 2, 3, 4, 5].map((weekday) => ({ id: `r${weekday}`, weekday, startMinute: 480, endMinute: 1200 })),
        exceptions: [],
      }),
    );
    const user = userEvent.setup();
    render(<CalendarManager />);

    await user.click(await screen.findByRole('button', { name: 'Disponibilidad' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disponibilidad para reuniones' });
    expect(await within(dialog).findByRole('region', { name: 'Horario semanal' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Lunes: desde')).toHaveValue('08:00');
    expect(within(dialog).getByLabelText('Lunes: hasta')).toHaveValue('20:00');
    expect(within(dialog).getAllByText('Sin atención')).toHaveLength(2); // sábado y domingo
  });
});
