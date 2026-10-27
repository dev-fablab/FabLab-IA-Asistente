import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '@/test/fetch-mock';
import { ConversationsManager } from './conversations-manager';

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/admin/conversations',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
// El cliente tipado pide el JWT de la sesión de Supabase antes de cada llamada.


const row = (n: number, overrides: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  createdAt: '2026-10-17T14:00:00.000Z',
  lastMessageAt: '2026-10-17T14:05:00.000Z',
  firstMessage: `Pregunta número ${n}`,
  messageCount: 2,
  hasNoAnswer: false,
  channel: 'web',
  ...overrides,
});

let api: ReturnType<typeof mockApi>;
let page: { items: object[]; page: number; total: number; totalPages: number };

beforeEach(() => {
  nav.search = '';
  nav.replace.mockReset();
  page = { items: [row(1), row(2, { hasNoAnswer: true, messageCount: 4 })], page: 1, total: 27, totalPages: 2 };
  api = mockApi();
  api.on('GET /api/admin/conversations', () => json(page));
});

afterEach(() => vi.unstubAllGlobals());

const lastQuery = () => Object.fromEntries(api.callsTo('GET', '/api/admin/conversations').at(-1)!.search);

describe('ConversationsManager: lista', () => {
  it('muestra fecha, primera pregunta, mensajes e insignia «Sin información»', async () => {
    render(<ConversationsManager />);

    const link = await screen.findByRole('link', { name: 'Pregunta número 1' });
    expect(link).toHaveAttribute('href', '/admin/conversations/00000000-0000-4000-8000-000000000001');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).queryByText('Sin información')).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('Sin información')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('4')).toBeInTheDocument();
    for (const header of ['Fecha', 'Primera pregunta', 'Mensajes', 'Estado']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('pide la primera página con la cookie de la sesión', async () => {
    render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 1' });

    expect(lastQuery()).toEqual({ page: '1' });
    const [, init] = api.fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });

  it('muestra la paginación y avanza conservando los filtros', async () => {
    nav.search = 'noAnswer=true&q=taller';
    const user = userEvent.setup();
    render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 1' });

    expect(screen.getByText('Página 1 de 2 · 27 conversaciones')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Siguiente/ }));

    expect(nav.replace).toHaveBeenCalledWith('/admin/conversations?page=2&noAnswer=true&q=taller');
  });

  it('en la última página no se puede avanzar', async () => {
    nav.search = 'page=2';
    page = { items: [row(26)], page: 2, total: 27, totalPages: 2 };
    render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 26' });

    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeEnabled();
    expect(lastQuery()).toEqual({ page: '2' });
  });
});

describe('ConversationsManager: filtros', () => {
  it('«Solo sin información» actualiza la URL y vuelve a la primera página', async () => {
    nav.search = 'page=2';
    const user = userEvent.setup();
    render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 1' });

    await user.click(screen.getByRole('switch', { name: /Solo «sin información»/ }));
    expect(nav.replace).toHaveBeenCalledWith('/admin/conversations?noAnswer=true');
  });

  it('traduce los filtros de la URL a la consulta de la API', async () => {
    nav.search = 'page=2&noAnswer=true&from=2026-03-01&to=2026-03-31&q=cer%C3%A1mica';
    render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 1' });

    expect(lastQuery()).toEqual({ page: '2', noAnswer: 'true', from: '2026-03-01', to: '2026-03-31', q: 'cerámica' });
    expect(screen.getByRole('switch', { name: /Solo «sin información»/ })).toBeChecked();
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-03-31');
    expect(screen.getByLabelText('Buscar en las conversaciones')).toHaveValue('cerámica');
  });

  it('la búsqueda se aplica al enviar el formulario', async () => {
    const user = userEvent.setup();
    render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 1' });

    await user.type(screen.getByLabelText('Buscar en las conversaciones'), 'impresión 3D');
    expect(nav.replace).not.toHaveBeenCalled(); // no busca en cada tecla
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(nav.replace).toHaveBeenCalledWith('/admin/conversations?q=impresi%C3%B3n+3D');
  });

  it('los filtros de fecha se aplican al cambiar', async () => {
    const user = userEvent.setup();
    render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 1' });

    await user.type(screen.getByLabelText('Desde'), '2026-03-10');
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/conversations?from=2026-03-10');
  });

  it('«Limpiar filtros» solo aparece con filtros y los quita todos', async () => {
    const { unmount } = render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 1' });
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument();
    unmount();

    nav.search = 'noAnswer=true&q=x';
    const user = userEvent.setup();
    render(<ConversationsManager />);
    await screen.findByRole('link', { name: 'Pregunta número 1' });
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(nav.replace).toHaveBeenCalledWith('/admin/conversations');
  });
});

describe('ConversationsManager: estados', () => {
  it('sin conversaciones explica cuándo aparecerán', async () => {
    page = { items: [], page: 1, total: 0, totalPages: 1 };
    render(<ConversationsManager />);
    expect(await screen.findByText(/Aún no hay conversaciones/)).toBeInTheDocument();
  });

  it('sin resultados con filtros lo dice distinto', async () => {
    nav.search = 'q=nada';
    page = { items: [], page: 1, total: 0, totalPages: 1 };
    render(<ConversationsManager />);
    expect(await screen.findByText('No hay conversaciones con estos filtros.')).toBeInTheDocument();
  });

  it('muestra un cargando mientras responde la API', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.on('GET /api/admin/conversations', async () => {
      await gate;
      return json(page);
    });
    render(<ConversationsManager />);

    expect(await screen.findByRole('status', { name: 'Cargando conversaciones' })).toBeInTheDocument();
    release();
    await screen.findByRole('link', { name: 'Pregunta número 1' });
    expect(screen.queryByRole('status', { name: 'Cargando conversaciones' })).not.toBeInTheDocument();
  });

  it('ante un error muestra el motivo y permite reintentar', async () => {
    let fail = true;
    api.on('GET /api/admin/conversations', () =>
      fail ? json({ error: { code: 'internal_error', message: 'Error interno' } }, 500) : json(page),
    );
    const user = userEvent.setup();
    render(<ConversationsManager />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error interno');

    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('link', { name: 'Pregunta número 1' });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
