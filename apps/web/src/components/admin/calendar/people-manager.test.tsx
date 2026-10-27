import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '@/test/fetch-mock';
import { PeopleManager } from './people-manager';

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/admin/calendar/people',
  useSearchParams: () => new URLSearchParams(nav.search),
}));


const CAMILA = '00000000-0000-4000-8000-000000000001';
const LUIS = '00000000-0000-4000-8000-000000000002';
const MEETING = '00000000-0000-4000-8000-0000000000aa';

const row = (id: string, name: string, overrides: object = {}) => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@correo.cl`,
  source: 'chat',
  createdAt: '2026-10-17T14:00:00.000Z',
  meetingCount: 2,
  upcomingCount: 1,
  nextMeetingAt: '2030-03-04T14:00:00.000Z', // 11:00 en Santiago (UTC-3)
  ...overrides,
});

const person = (id: string, name: string, overrides: object = {}) => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@correo.cl`,
  source: 'chat',
  createdAt: '2026-10-17T14:00:00.000Z',
  createdById: null,
  createdByName: null,
  methods: [],
  ...overrides,
});

const meetings = [
  { id: MEETING, startsAt: '2030-03-04T14:00:00.000Z', endsAt: '2030-03-04T15:00:00.000Z', status: 'scheduled', reason: 'Quiero construir un robot', responsibleId: null, responsibleName: null },
  { id: 'otra', startsAt: '2029-12-04T14:00:00.000Z', endsAt: '2029-12-04T15:00:00.000Z', status: 'completed', reason: 'Primera visita', responsibleId: 'p1', responsibleName: 'Ana Pérez' },
];

let api: ReturnType<typeof mockApi>;
let page: { items: object[]; page: number; pageSize: number; total: number; totalPages: number };
let camila: ReturnType<typeof person>;

beforeEach(() => {
  nav.search = '';
  nav.replace.mockReset();
  page = {
    items: [row(CAMILA, 'Camila Rojas'), row(LUIS, 'Luis Mora', { source: 'phone', meetingCount: 0, upcomingCount: 0, nextMeetingAt: null })],
    page: 1,
    pageSize: 25,
    total: 27,
    totalPages: 2,
  };
  camila = person(CAMILA, 'Camila Rojas');
  api = mockApi();
  api.on('GET /api/admin/calendar/people', () => json(page));
  api.on(`GET /api/admin/calendar/people/${CAMILA}`, () => json({ person: camila, meetings }));
  api.on(`GET /api/admin/calendar/people/${LUIS}`, () =>
    json({ person: person(LUIS, 'Luis Mora', { source: 'phone', createdById: 'p1', createdByName: 'Ana Pérez' }), meetings: [] }),
  );
  api.on('GET /api/admin/team', () => json({ members: [] }));
  api.on('GET /api/admin/me', () => json({ id: 'p1', email: 'ana@fablab.cl', role: 'staff' }));
  api.on(`GET /api/admin/calendar/meetings/${MEETING}`, () =>
    json({
      meeting: { ...meetings[0], conversationSummary: 'Quiere un robot.', conversationId: null, createdAt: '2026-10-17T14:00:00.000Z', responsibleId: null, contact: { id: CAMILA, name: 'Camila Rojas', email: 'camila@correo.cl', source: 'chat', methods: [] } },
      responsible: null,
      minutes: [],
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const lastQuery = () => Object.fromEntries(api.callsTo('GET', '/api/admin/calendar/people').at(-1)!.search);
const openRow = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(await screen.findByRole('button', { name: `Ver los datos de ${name}` }));

describe('PeopleManager: lista', () => {
  it('lista a las personas con su correo, el medio, cuántas reuniones llevan y cuándo es la próxima', async () => {
    render(<PeopleManager />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Personas' })).toBeInTheDocument();
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText('Camila Rojas')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: 'camila@correo.cl' })).toHaveAttribute('href', 'mailto:camila@correo.cl');
    expect(within(rows[0]!).getByText('Chat')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Teléfono')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/4 mar 2030, 11:00/)).toBeInTheDocument(); // en la hora de Fab Lab
    expect(within(rows[1]!).getByText('Sin reuniones por venir')).toBeInTheDocument();
    for (const header of ['Persona', 'Medio', 'Reuniones', 'Próxima reunión', 'Registrada']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('busca por nombre o correo y vuelve a la primera página', async () => {
    const user = userEvent.setup();
    render(<PeopleManager />);

    await user.type(await screen.findByRole('searchbox', { name: 'Buscar por nombre o correo' }), '  camila  ');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(nav.replace).toHaveBeenCalledWith('/admin/calendar/people?q=camila');
  });

  it('filtra por medio y lo deja en la URL', async () => {
    const user = userEvent.setup();
    render(<PeopleManager />);

    await user.click(await screen.findByRole('combobox', { name: 'Medio' }));
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent?.trim());
    expect(options).toEqual(['Todos los medios', 'Chat', 'Presencial', 'Teléfono', 'WhatsApp', 'Correo', 'Redes sociales', 'Otro']);
    await user.click(screen.getByRole('option', { name: 'Teléfono' }));

    expect(nav.replace).toHaveBeenCalledWith('/admin/calendar/people?source=phone');
  });

  it('lee la búsqueda, el medio y la página de la URL y los envía a la API; un medio inválido se ignora', async () => {
    nav.search = 'q=luis&page=2&source=phone';
    const { unmount } = render(<PeopleManager />);
    await waitFor(() => expect(lastQuery()).toEqual({ page: '2', q: 'luis', source: 'phone' }));
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeInTheDocument();
    unmount();

    nav.search = 'source=paloma';
    render(<PeopleManager />);
    await waitFor(() => expect(lastQuery()).toEqual({ page: '1' }));
  });

  it('pagina con Anterior y Siguiente', async () => {
    const user = userEvent.setup();
    render(<PeopleManager />);

    expect(await screen.findByText('Página 1 de 2 · 27 personas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(nav.replace).toHaveBeenCalledWith('/admin/calendar/people?page=2');
  });

  it('sin resultados explica por qué según si hay filtros o no', async () => {
    page = { ...page, items: [], total: 0, totalPages: 1 };
    const { unmount } = render(<PeopleManager />);
    expect(await screen.findByText(/Aún no hay personas/)).toBeInTheDocument();
    unmount();

    nav.search = 'source=phone';
    render(<PeopleManager />);
    expect(await screen.findByText('No hay personas que coincidan con los filtros.')).toBeInTheDocument();
  });

  it('si falla la carga muestra el error y permite reintentar', async () => {
    let attempts = 0;
    api.on('GET /api/admin/calendar/people', () => (++attempts === 1 ? json({ error: { code: 'internal_error', message: 'Base de datos caída' } }, 500) : json(page)));
    const user = userEvent.setup();
    render(<PeopleManager />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Base de datos caída');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Camila Rojas')).toBeInTheDocument();
  });
});

describe('PeopleManager: ficha desplegada', () => {
  it('muestra las reuniones con su estado, motivo y responsable, y quién registró a la persona', async () => {
    const user = userEvent.setup();
    render(<PeopleManager />);

    await openRow(user, 'Camila Rojas');
    const list = await screen.findByRole('list', { name: 'Reuniones de Camila Rojas' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Agendada')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Sin responsable')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Realizada')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText(/Registrada por el asistente, al agendar por el chat/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar los datos de Camila Rojas' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('muestra los otros medios de contacto con enlace y quién la registró cuando fue el equipo', async () => {
    camila = person(CAMILA, 'Camila Rojas', {
      source: 'in_person',
      createdById: 'p1',
      createdByName: 'Ana Pérez',
      methods: [
        { id: 'k1', type: 'phone', value: '+56 9 1234 5678' },
        { id: 'k2', type: 'social', value: 'https://instagram.com/camila' },
      ],
    });
    const user = userEvent.setup();
    render(<PeopleManager />);

    await openRow(user, 'Camila Rojas');
    const methods = await screen.findByRole('list', { name: 'Medios de contacto de Camila Rojas' });
    expect(within(methods).getByRole('link', { name: '+56 9 1234 5678' })).toHaveAttribute('href', 'tel:+56912345678');
    expect(within(methods).getByRole('link', { name: 'https://instagram.com/camila' })).toHaveAttribute('href', 'https://instagram.com/camila');
    expect(screen.getByText(/Registrada por Ana Pérez/)).toBeInTheDocument();
  });

  it('sin otros medios lo dice, y solo hay una ficha abierta a la vez', async () => {
    const user = userEvent.setup();
    render(<PeopleManager />);

    await openRow(user, 'Camila Rojas');
    expect(await screen.findByText('Sin otros medios de contacto además del correo.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver los datos de Luis Mora' }));

    expect(await screen.findByText('Esta persona todavía no tiene reuniones.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Reuniones de Camila Rojas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ocultar los datos de Luis Mora' }));
    expect(screen.queryByText('Esta persona todavía no tiene reuniones.')).not.toBeInTheDocument();
  });

  it('al hacer clic en una reunión abre su detalle', async () => {
    const user = userEvent.setup();
    render(<PeopleManager />);

    await openRow(user, 'Camila Rojas');
    const list = await screen.findByRole('list', { name: 'Reuniones de Camila Rojas' });
    await user.click(within(list).getByRole('button', { name: /Quiero construir un robot/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Reunión con Camila Rojas' });
    expect(within(dialog).getByText('Quiere un robot.')).toBeInTheDocument();
  });
});

describe('PeopleManager: agregar y editar', () => {
  it('registra a una persona con nombre, correo, medio y otros medios de contacto', async () => {
    const NEW = '00000000-0000-4000-8000-0000000000bb';
    api.on('POST /api/admin/calendar/people', () =>
      json({ person: person(NEW, 'Nueva Persona', { email: 'nueva@correo.cl', source: 'in_person', createdById: 'p1', createdByName: 'Ana Pérez' }), meetings: [] }, 201),
    );
    const user = userEvent.setup();
    render(<PeopleManager />);

    await user.click(await screen.findByRole('button', { name: 'Agregar persona' }));
    const dialog = await screen.findByRole('dialog', { name: 'Agregar persona' });
    await user.type(within(dialog).getByLabelText('Nombre'), '  Nueva Persona ');
    await user.type(within(dialog).getByLabelText('Correo'), 'nueva@correo.cl');
    expect(within(dialog).getByRole('combobox', { name: 'Medio por el que llegó' })).toHaveTextContent('Presencial'); // por defecto

    await user.click(within(dialog).getByRole('button', { name: 'Agregar medio de contacto' }));
    await user.type(within(dialog).getByLabelText('Valor del medio 1'), '+56 9 1234 5678');
    await user.click(within(dialog).getByRole('button', { name: 'Agregar medio de contacto' })); // fila vacía: se ignora
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar persona' })).not.toBeInTheDocument());
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Nueva Persona',
      email: 'nueva@correo.cl',
      source: 'in_person',
      methods: [{ type: 'phone', value: '+56 9 1234 5678' }],
    });
    // La lista se vuelve a consultar y pasa a buscar su correo para que la persona nueva se vea aunque hubiera filtros.
    await waitFor(() => expect(api.callsTo('GET', '/api/admin/calendar/people').length).toBeGreaterThan(1));
    expect(nav.replace).toHaveBeenCalledWith('/admin/calendar/people?q=nueva%40correo.cl');
  });

  it('el nombre y el correo son obligatorios: no se envía sin ellos', async () => {
    const user = userEvent.setup();
    render(<PeopleManager />);

    await user.click(await screen.findByRole('button', { name: 'Agregar persona' }));
    const dialog = await screen.findByRole('dialog', { name: 'Agregar persona' });
    expect(within(dialog).getByLabelText('Nombre')).toBeRequired();
    expect(within(dialog).getByLabelText('Correo')).toBeRequired();
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('si el correo ya existe muestra el motivo y deja el formulario abierto con lo escrito', async () => {
    api.on('POST /api/admin/calendar/people', () => json({ error: { code: 'conflict', message: 'Ya existe una persona con ese correo' } }, 409));
    const user = userEvent.setup();
    render(<PeopleManager />);

    await user.click(await screen.findByRole('button', { name: 'Agregar persona' }));
    const dialog = await screen.findByRole('dialog', { name: 'Agregar persona' });
    await user.type(within(dialog).getByLabelText('Nombre'), 'Camila Otra');
    await user.type(within(dialog).getByLabelText('Correo'), 'camila@correo.cl');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ya existe una persona con ese correo');
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Camila Otra');
  });

  it('edita a una persona con sus datos cargados y puede quitar un medio de contacto', async () => {
    camila = person(CAMILA, 'Camila Rojas', {
      source: 'whatsapp',
      methods: [
        { id: 'k1', type: 'phone', value: '+56 9 1234 5678' },
        { id: 'k2', type: 'whatsapp', value: '+56 9 8765 4321' },
      ],
    });
    api.on(`PATCH /api/admin/calendar/people/${CAMILA}`, () => json({ person: { ...camila, name: 'Camila R. Soto' }, meetings }));
    const user = userEvent.setup();
    render(<PeopleManager />);

    await openRow(user, 'Camila Rojas');
    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar persona' });
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Camila Rojas');
    expect(within(dialog).getByLabelText('Correo')).toHaveValue('camila@correo.cl');
    expect(within(dialog).getByRole('combobox', { name: 'Medio por el que llegó' })).toHaveTextContent('WhatsApp');
    expect(within(dialog).getByLabelText('Valor del medio 1')).toHaveValue('+56 9 1234 5678');

    const name = within(dialog).getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'Camila R. Soto');
    await user.click(within(dialog).getByRole('button', { name: 'Quitar el medio 1' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar persona' })).not.toBeInTheDocument());
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Camila R. Soto',
      email: 'camila@correo.cl',
      source: 'whatsapp',
      methods: [{ type: 'whatsapp', value: '+56 9 8765 4321' }],
    });
  });

  it('cancelar no guarda nada', async () => {
    const user = userEvent.setup();
    render(<PeopleManager />);

    await user.click(await screen.findByRole('button', { name: 'Agregar persona' }));
    const dialog = await screen.findByRole('dialog', { name: 'Agregar persona' });
    await user.type(within(dialog).getByLabelText('Nombre'), 'Nadie');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar persona' })).not.toBeInTheDocument());
    expect(api.calls.some((call) => call.method === 'POST' || call.method === 'PATCH')).toBe(false);
  });
});
