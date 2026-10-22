import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '@/test/fetch-mock';
import { MeetingDetailDialog } from './meeting-detail-dialog';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } }),
}));

const ID = '00000000-0000-4000-8000-000000000042';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000099';

const TEAM = [
  { id: 'p-ana', email: 'ana@fablab.cl', fullName: 'Ana Pérez', role: 'staff' },
  { id: 'p-bruno', email: 'bruno@fablab.cl', fullName: null, role: 'admin' },
];
const ME = 'p-ana';

const detail = (overrides: Record<string, unknown> = {}, responsible: unknown = null) => ({
  meeting: {
    id: ID,
    startsAt: '2026-10-26T14:00:00.000Z', // 11:00 en Santiago (UTC-3)
    endsAt: '2026-10-26T15:00:00.000Z',
    status: 'scheduled',
    reason: 'Quiero construir un robot',
    conversationSummary: 'Camila quiere construir un robot para su ramo y necesita la cortadora láser.',
    conversationId: CONVERSATION_ID,
    createdAt: '2026-10-20T12:00:00.000Z',
    responsibleId: responsible ? (responsible as { id: string }).id : null,
    contact: { id: 'c1', name: 'Camila Rojas', email: 'camila@correo.cl', source: 'chat', methods: [] },
    ...overrides,
  },
  responsible,
  minutes: [
    { id: 'm1', content: 'Necesita un robot para su ramo', source: 'agent', createdAt: '2026-10-20T12:00:00.000Z' },
    { id: 'm2', content: 'Requiere la cortadora láser', source: 'agent', createdAt: '2026-10-20T12:00:00.000Z' },
  ],
});

let api: ReturnType<typeof mockApi>;
const onClose = vi.fn();
const onChanged = vi.fn();

const open = () => render(<MeetingDetailDialog meetingId={ID} onClose={onClose} onChanged={onChanged} />);

beforeEach(() => {
  api = mockApi();
  api.on(`GET /api/admin/calendar/meetings/${ID}`, () => json(detail()));
  api.on('GET /api/admin/team', () => json({ members: TEAM }));
  api.on('GET /api/admin/me', () => json({ id: ME, email: 'ana@fablab.cl', role: 'staff' }));
  onClose.mockClear();
  onChanged.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('MeetingDetailDialog', () => {
  it('muestra el solicitante, el motivo, el resumen de la conversación y el acta', async () => {
    open();

    const dialog = await screen.findByRole('dialog', { name: 'Reunión con Camila Rojas' });
    expect(within(dialog).getByText(/de 11:00 a 12:00/)).toBeInTheDocument();
    expect(within(dialog).getByText('Presencial en Fab Lab')).toBeInTheDocument();

    const requester = within(dialog).getByRole('region', { name: 'Persona' });
    expect(within(requester).getByText('Camila Rojas')).toBeInTheDocument();
    expect(within(requester).getByRole('link', { name: 'camila@correo.cl' })).toHaveAttribute('href', 'mailto:camila@correo.cl');
    expect(within(requester).getByText('Quiero construir un robot')).toBeInTheDocument();

    const summary = within(dialog).getByRole('region', { name: 'Resumen de la conversación' });
    expect(within(summary).getByText(/necesita la cortadora láser/)).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: /Ver la conversación completa/ })).toHaveAttribute('href', `/admin/conversations/${CONVERSATION_ID}`);

    const minutes = within(dialog).getByRole('list', { name: 'Puntos del acta' });
    expect(within(minutes).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Necesita un robot para su ramoAgente',
      'Requiere la cortadora láserAgente',
    ]);
  });

  it('muestra el medio por el que llegó la persona y sus otros medios de contacto', async () => {
    api.on(`GET /api/admin/calendar/meetings/${ID}`, () =>
      json(
        detail({
          contact: {
            id: 'c1',
            name: 'Camila Rojas',
            email: 'camila@correo.cl',
            source: 'phone',
            methods: [
              { id: 'k1', type: 'whatsapp', value: '+56 9 1234 5678' },
              { id: 'k2', type: 'social', value: 'https://instagram.com/camila' },
            ],
          },
        }),
      ),
    );
    open();

    const person = await screen.findByRole('region', { name: 'Persona' });
    expect(within(person).getByText('Teléfono', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    const methods = within(person).getByRole('list', { name: 'Otros medios de contacto' });
    expect(within(methods).getByRole('link', { name: '+56 9 1234 5678' })).toHaveAttribute('href', 'https://wa.me/56912345678');
    expect(within(methods).getByRole('link', { name: 'https://instagram.com/camila' })).toHaveAttribute('target', '_blank');
  });

  it('sin otros medios de contacto no muestra esa fila', async () => {
    open();
    const person = await screen.findByRole('region', { name: 'Persona' });
    expect(within(person).getByText('Chat', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    expect(within(person).queryByText('Otros medios')).not.toBeInTheDocument();
  });

  it('sin resumen ni conversación lo dice y no ofrece el enlace', async () => {
    api.on(`GET /api/admin/calendar/meetings/${ID}`, () => json(detail({ conversationSummary: null, conversationId: null })));
    open();

    const summary = await screen.findByRole('region', { name: 'Resumen de la conversación' });
    expect(within(summary).getByText(/no dejó un resumen/)).toBeInTheDocument();
    expect(within(summary).queryByRole('link')).not.toBeInTheDocument();
  });

  it('el equipo agrega un punto al acta', async () => {
    api.on(`POST /api/admin/calendar/meetings/${ID}/minutes`, (call) =>
      json({ minute: { id: 'm3', content: (call.body as { content: string }).content, source: 'staff', createdAt: '2026-10-26T15:00:00.000Z' } }, 201),
    );
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByRole('textbox', { name: 'Nuevo punto del acta' }), 'Se requiere el visto bueno del departamento');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));

    const minutes = screen.getByRole('list', { name: 'Puntos del acta' });
    expect(await within(minutes).findByText('Se requiere el visto bueno del departamento')).toBeInTheDocument();
    expect(within(minutes).getAllByRole('listitem')).toHaveLength(3);
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({ content: 'Se requiere el visto bueno del departamento' });
  });

  it('edita y elimina un punto del acta', async () => {
    api.on('PATCH /api/admin/calendar/minutes/m1', (call) =>
      json({ minute: { id: 'm1', content: (call.body as { content: string }).content, source: 'agent', createdAt: '2026-10-20T12:00:00.000Z' } }),
    );
    api.on('DELETE /api/admin/calendar/minutes/m2', () => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: 'Editar punto: Necesita un robot para su ramo' }));
    const input = screen.getByRole('textbox', { name: 'Punto del acta' });
    await user.clear(input);
    await user.type(input, 'Necesita un robot seguidor de línea');
    await user.click(screen.getByRole('button', { name: 'Guardar punto' }));
    expect(await screen.findByText('Necesita un robot seguidor de línea')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Eliminar punto: Requiere la cortadora láser' }));
    await vi.waitFor(() => expect(screen.queryByText('Requiere la cortadora láser')).not.toBeInTheDocument());
  });

  it('cancelar pide confirmación, cancela la reunión y cierra el detalle', async () => {
    api.on(`PATCH /api/admin/calendar/meetings/${ID}`, () => json(detail({ status: 'cancelled' })));
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: 'Cancelar reunión' }));
    const confirm = await screen.findByRole('alertdialog', { name: '¿Cancelar esta reunión?' });
    expect(api.calls.some((call) => call.method === 'PATCH')).toBe(false);

    await user.click(within(confirm).getByRole('button', { name: 'Cancelar reunión' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ status: 'cancelled' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('marcar como realizada actualiza el estado y avisa al calendario', async () => {
    api.on(`PATCH /api/admin/calendar/meetings/${ID}`, () => json(detail({ status: 'completed' })));
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: 'Marcar como realizada' }));
    expect(await screen.findByText('Realizada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reabrir como agendada' })).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('si falla la carga muestra el error con «Reintentar»', async () => {
    let attempts = 0;
    api.on(`GET /api/admin/calendar/meetings/${ID}`, () =>
      ++attempts === 1 ? json({ error: { code: 'internal_error', message: 'Error del servidor' } }, 500) : json(detail()),
    );
    const user = userEvent.setup();
    open();

    expect(await screen.findByRole('alert')).toHaveTextContent('Error del servidor');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('dialog', { name: 'Reunión con Camila Rojas' })).toBeInTheDocument();
  });

  describe('responsable', () => {
    const assigned = (member: (typeof TEAM)[number]) => ({ id: member.id, name: member.fullName ?? member.email, email: member.email, role: member.role });

    it('una reunión sin responsable lo advierte', async () => {
      open();
      const section = await screen.findByRole('region', { name: 'Responsable' });
      expect(within(section).getByText('Sin responsable', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
      expect(within(section).getByRole('combobox', { name: 'Responsable de la reunión' })).toBeInTheDocument();
    });

    it('ofrece a todo el equipo, staff y administración, y asigna a quien se elija', async () => {
      api.on(`PATCH /api/admin/calendar/meetings/${ID}`, (call) => {
        expect(call.body).toEqual({ responsibleId: 'p-bruno' });
        return json(detail({}, assigned(TEAM[1]!)));
      });
      const user = userEvent.setup();
      open();

      const section = await screen.findByRole('region', { name: 'Responsable' });
      await vi.waitFor(() => expect(within(section).getByRole('combobox')).toBeEnabled());
      await user.click(within(section).getByRole('combobox'));
      const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
      expect(options).toEqual(['Sin responsable', 'Ana Pérez · Staff', 'bruno@fablab.cl · Administración']);

      await user.click(screen.getByRole('option', { name: 'bruno@fablab.cl · Administración' }));
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(within(section).getByRole('combobox')).toHaveTextContent('bruno@fablab.cl · Administración');
      expect(within(section).queryByText('Sin responsable', { selector: '[data-slot="badge"]' })).not.toBeInTheDocument();
    });

    it('«Asignarme a mí» toma la reunión y deja de ofrecerse', async () => {
      api.on(`PATCH /api/admin/calendar/meetings/${ID}`, () => json(detail({}, assigned(TEAM[0]!))));
      const user = userEvent.setup();
      open();

      await user.click(await screen.findByRole('button', { name: 'Asignarme a mí' }));
      await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Asignarme a mí' })).not.toBeInTheDocument());
      expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ responsibleId: ME });
      expect(screen.getByRole('combobox', { name: 'Responsable de la reunión' })).toHaveTextContent('Ana Pérez · Staff');
    });

    it('se puede quitar al responsable', async () => {
      api.on(`GET /api/admin/calendar/meetings/${ID}`, () => json(detail({}, assigned(TEAM[1]!))));
      api.on(`PATCH /api/admin/calendar/meetings/${ID}`, () => json(detail()));
      const user = userEvent.setup();
      open();

      const section = await screen.findByRole('region', { name: 'Responsable' });
      await vi.waitFor(() => expect(within(section).getByRole('combobox')).toBeEnabled());
      await user.click(within(section).getByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: 'Sin responsable' }));

      await vi.waitFor(() => expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ responsibleId: null }));
      expect(await within(section).findByText('Sin responsable', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    });

    it('si falla el cambio, el responsable no cambia y no se avisa al calendario', async () => {
      api.on(`PATCH /api/admin/calendar/meetings/${ID}`, () => json({ error: { code: 'bad_request', message: 'Esa persona no es parte del equipo' } }, 400));
      const user = userEvent.setup();
      open();

      await user.click(await screen.findByRole('button', { name: 'Asignarme a mí' }));
      await vi.waitFor(() => expect(api.calls.some((call) => call.method === 'PATCH')).toBe(true));
      expect(onChanged).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Asignarme a mí' })).toBeEnabled();
    });
  });

  describe('reagendar', () => {
    it('propone la fecha y hora actuales en la hora de Fab Lab', async () => {
      open();
      const section = await screen.findByRole('region', { name: 'Reagendar' });
      expect(within(section).getByLabelText('Fecha')).toHaveValue('2026-10-26');
      expect(within(section).getByLabelText('Hora de inicio')).toHaveValue('11:00');
    });

    it('envía el nuevo horario como instante exacto (hora de Fab Lab) y avisa al calendario', async () => {
      api.on(`PATCH /api/admin/calendar/meetings/${ID}`, () =>
        json(detail({ startsAt: '2030-03-05T13:00:00.000Z', endsAt: '2030-03-05T14:00:00.000Z' })),
      );
      const user = userEvent.setup();
      open();

      const section = await screen.findByRole('region', { name: 'Reagendar' });
      const date = within(section).getByLabelText('Fecha');
      const time = within(section).getByLabelText('Hora de inicio');
      await user.clear(date);
      await user.type(date, '2030-03-05');
      await user.clear(time);
      await user.type(time, '10:00');
      await user.click(within(section).getByRole('button', { name: 'Reagendar' }));

      await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
      // 10:00 en Santiago es 13:00 UTC en marzo (UTC-3).
      expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ startsAt: '2030-03-05T13:00:00.000Z' });
      expect(await screen.findByText(/de 10:00 a 11:00/)).toBeInTheDocument();
    });

    it('si el servidor lo rechaza no avisa al calendario y deja el horario como estaba', async () => {
      api.on(`PATCH /api/admin/calendar/meetings/${ID}`, () => json({ error: { code: 'bad_request', message: 'Ese horario está fuera del horario de atención' } }, 400));
      const user = userEvent.setup();
      open();

      const section = await screen.findByRole('region', { name: 'Reagendar' });
      await user.click(within(section).getByRole('button', { name: 'Reagendar' }));

      await vi.waitFor(() => expect(api.calls.some((call) => call.method === 'PATCH')).toBe(true));
      expect(onChanged).not.toHaveBeenCalled();
      expect(screen.getByText(/de 11:00 a 12:00/)).toBeInTheDocument();
    });

    it('una reunión realizada no se puede reagendar', async () => {
      api.on(`GET /api/admin/calendar/meetings/${ID}`, () => json(detail({ status: 'completed' })));
      open();

      await screen.findByRole('region', { name: 'Responsable' });
      expect(screen.queryByRole('region', { name: 'Reagendar' })).not.toBeInTheDocument();
    });
  });
});
