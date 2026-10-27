import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AdminSidebar } from './admin-sidebar';

const nav = vi.hoisted(() => ({ pathname: '/admin/documents' }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: async () => undefined } }));

const renderSidebar = (role: 'admin' | 'staff' = 'staff') =>
  render(
    <SidebarProvider>
      <AdminSidebar email="ana@fablab.cl" role={role} />
    </SidebarProvider>,
  );

const conocimiento = () => screen.getByRole('button', { name: 'Conocimiento' });
const calendario = () => screen.getByRole('button', { name: 'Calendario' });

beforeEach(() => {
  nav.pathname = '/admin/documents';
  // El sidebar de escritorio solo se dibuja con una ventana ancha.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
});

describe('AdminSidebar: submenú de Conocimiento', () => {
  it('Historial sigue siendo un enlace y Conocimiento agrupa Documentos y Contacto', () => {
    renderSidebar();

    expect(screen.queryByRole('link', { name: 'Conocimiento' })).not.toBeInTheDocument();
    expect(conocimiento()).toHaveAttribute('aria-expanded', 'true');
    expect(conocimiento().querySelector('.lucide-sparkle')).toBeInTheDocument();
    const submenu = screen.getByRole('list', { name: 'Conocimiento' });
    expect(within(submenu).getByRole('link', { name: 'Documentos' })).toHaveAttribute('href', '/admin/documents');
    expect(within(submenu).getByRole('link', { name: 'Contacto' })).toHaveAttribute('href', '/admin/contact');
    expect(screen.getByRole('link', { name: 'Historial' })).toHaveAttribute('href', '/admin/conversations');
  });

  it('el submenú está cerrado fuera de la sección y se abre al hacer clic', async () => {
    nav.pathname = '/admin/conversations';
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Documentos' })).not.toBeInTheDocument();

    await user.click(conocimiento());

    expect(conocimiento()).toHaveAttribute('aria-expanded', 'true');
    const submenu = screen.getByRole('list', { name: 'Conocimiento' });
    const links = within(submenu).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Documentos', '/admin/documents'],
      ['Contacto', '/admin/contact'],
    ]);
  });

  it('se puede volver a cerrar', async () => {
    nav.pathname = '/admin/conversations';
    const user = userEvent.setup();
    renderSidebar();
    await user.click(conocimiento());
    await user.click(conocimiento());
    expect(conocimiento()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Documentos' })).not.toBeInTheDocument();
  });

  it.each([
    ['/admin/documents', 'Documentos', 'Contacto'],
    ['/admin/contact', 'Contacto', 'Documentos'],
  ])('dentro de %s el submenú está abierto y marca la página actual', (pathname, current, other) => {
    nav.pathname = pathname;
    renderSidebar();

    expect(conocimiento()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: other })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Historial' })).not.toHaveAttribute('aria-current');
  });

  it('si la persona cierra el submenú estando en la sección, se respeta', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(conocimiento());
    expect(conocimiento()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Documentos' })).not.toBeInTheDocument();
  });
});

describe('AdminSidebar: submenú de Calendario', () => {
  it('Calendario es un grupo desplegable', () => {
    nav.pathname = '/admin/conversations';
    renderSidebar();

    expect(screen.queryByRole('link', { name: 'Calendario' })).not.toBeInTheDocument();
    expect(calendario()).toHaveAttribute('aria-expanded', 'false');
  });

  it('el submenú está cerrado fuera de la sección y se abre al hacer clic, con Personas y Agenda', async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Agenda' })).not.toBeInTheDocument();

    await user.click(calendario());

    expect(calendario()).toHaveAttribute('aria-expanded', 'true');
    const submenu = screen.getByRole('list', { name: 'Calendario' });
    const links = within(submenu).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Personas', '/admin/calendar/people'],
      ['Agenda', '/admin/calendar/agenda'],
    ]);
    expect(within(submenu).queryByRole('link', { name: 'Calendario' })).not.toBeInTheDocument();
  });

  it('se puede volver a cerrar', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(calendario());
    await user.click(calendario());
    expect(calendario()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Agenda' })).not.toBeInTheDocument();
  });

  it.each([
    ['/admin/calendar/agenda', 'Agenda'],
    ['/admin/calendar/people', 'Personas'],
  ])('dentro de %s el submenú está abierto y marca la página actual', (pathname, current) => {
    nav.pathname = pathname;
    renderSidebar();

    expect(calendario()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
    const other = current === 'Agenda' ? 'Personas' : 'Agenda';
    expect(screen.getByRole('link', { name: other })).not.toHaveAttribute('aria-current');
  });

  it('un enlace de otra sección no queda marcado como actual', () => {
    nav.pathname = '/admin/conversations/123';
    renderSidebar();

    expect(screen.getByRole('link', { name: 'Historial' })).toHaveAttribute('aria-current', 'page');
    expect(conocimiento()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Documentos' })).not.toBeInTheDocument();
  });

  it('si la persona cierra el submenú estando en la sección, se respeta', async () => {
    nav.pathname = '/admin/calendar/agenda';
    const user = userEvent.setup();
    renderSidebar();

    await user.click(calendario());
    expect(calendario()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Agenda' })).not.toBeInTheDocument();
  });
});

describe('AdminSidebar: accesos', () => {
  it('el personal no ve la sección', () => {
    renderSidebar('staff');
    expect(screen.queryByRole('link', { name: 'Accesos' })).not.toBeInTheDocument();
  });

  it('un administrador ve la sección', () => {
    renderSidebar('admin');
    expect(screen.getByRole('link', { name: 'Accesos' })).toHaveAttribute('href', '/admin/users');
  });
});
