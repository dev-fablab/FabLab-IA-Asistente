import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '@/test/fetch-mock';
import { ContactManager } from './contact-manager';


vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const channel = (n: number, overrides: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  type: 'phone',
  label: `Canal ${n}`,
  value: '+56 9 1234 5678',
  notes: null,
  sortOrder: n,
  isActive: true,
  ...overrides,
});

let api: ReturnType<typeof mockApi>;
let channels: ReturnType<typeof channel>[];

beforeEach(() => {
  channels = [
    channel(1, { label: 'Teléfono de atención', notes: 'Lunes a viernes' }),
    channel(2, { type: 'email', label: 'Correo', value: 'fablab@inacap.cl', isActive: false }),
  ];
  api = mockApi();
  api.on('GET /api/admin/contact-channels', () => json({ channels }));
});
afterEach(() => vi.unstubAllGlobals());

const rowOf = (label: string) => screen.getByRole('row', { name: new RegExp(label) });

describe('ContactManager: lista', () => {
  it('muestra tipo, etiqueta, valor, notas, estado y orden de cada canal', async () => {
    render(<ContactManager />);
    await screen.findByText('Teléfono de atención');

    const phone = rowOf('Teléfono de atención');
    expect(within(phone).getByText('Teléfono')).toBeInTheDocument();
    expect(within(phone).getByText('+56 9 1234 5678')).toBeInTheDocument();
    expect(within(phone).getByText('Lunes a viernes')).toBeInTheDocument();
    expect(within(phone).getByRole('switch')).toBeChecked();
    expect(within(rowOf('Correo')).getByText('Correo', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    expect(within(rowOf('Correo')).getByRole('switch')).not.toBeChecked();
    for (const header of ['Orden', 'Tipo', 'Etiqueta', 'Valor', 'Notas', 'Activo']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('explica que solo los canales activos los ve el asistente', async () => {
    render(<ContactManager />);
    expect(await screen.findByText(/Solo los activos los ve el asistente/)).toBeInTheDocument();
  });

  it('sin canales explica por qué importa', async () => {
    channels = [];
    render(<ContactManager />);
    expect(await screen.findByText(/Aún no hay canales de contacto/)).toBeInTheDocument();
  });

  it('ante un error muestra el motivo y permite reintentar', async () => {
    let fail = true;
    api.on('GET /api/admin/contact-channels', () => (fail ? json({ error: { code: 'internal_error', message: 'Error interno' } }, 500) : json({ channels })));
    const user = userEvent.setup();
    render(<ContactManager />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error interno');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await screen.findByText('Teléfono de atención');
  });
});

describe('ContactManager: activar y desactivar', () => {
  it('el interruptor de la fila actualiza solo el estado', async () => {
    api.on('PATCH /api/admin/contact-channels/:id', () => json({ channel: channels[0] }));
    const user = userEvent.setup();
    render(<ContactManager />);
    await screen.findByText('Teléfono de atención');

    await user.click(within(rowOf('Teléfono de atención')).getByRole('switch'));

    await waitFor(() => expect(api.callsTo('PATCH', `/api/admin/contact-channels/${channels[0]!.id}`)).toHaveLength(1));
    expect(api.callsTo('PATCH', `/api/admin/contact-channels/${channels[0]!.id}`)[0]!.body).toEqual({ isActive: false });
  });
});

describe('ContactManager: agregar', () => {
  it('abre el formulario con el siguiente orden y envía el canal nuevo', async () => {
    api.on('POST /api/admin/contact-channels', () => json({ channel: channel(3) }, 201));
    const user = userEvent.setup();
    render(<ContactManager />);
    await screen.findByText('Teléfono de atención');

    await user.click(screen.getByRole('button', { name: /Agregar canal/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Agregar canal de contacto' });
    expect(within(dialog).getByLabelText('Orden')).toHaveValue(3); // sigue al mayor existente (2)
    expect(within(dialog).getByLabelText('Valor')).toHaveAttribute('placeholder', '+56 9 1234 5678');

    await user.type(within(dialog).getByLabelText('Etiqueta'), 'Línea directa');
    await user.type(within(dialog).getByLabelText('Valor'), '+56 2 2345 6789');
    await user.type(within(dialog).getByLabelText(/Notas/), 'Solo mañanas');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(api.callsTo('POST', '/api/admin/contact-channels')).toHaveLength(1));
    expect(api.callsTo('POST', '/api/admin/contact-channels')[0]!.body).toEqual({
      type: 'phone',
      label: 'Línea directa',
      value: '+56 2 2345 6789',
      notes: 'Solo mañanas',
      sortOrder: 3,
      isActive: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('si la API rechaza el valor muestra el motivo exacto y deja el formulario abierto', async () => {
    api.on('POST /api/admin/contact-channels', () =>
      json({ error: { code: 'bad_request', message: 'El teléfono debe incluir el prefijo del país, por ejemplo +56 9 1234 5678' } }, 400),
    );
    const user = userEvent.setup();
    render(<ContactManager />);
    await screen.findByText('Teléfono de atención');

    await user.click(screen.getByRole('button', { name: /Agregar canal/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Etiqueta'), 'Mal número');
    await user.type(within(dialog).getByLabelText('Valor'), '912345678');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('prefijo del país');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Lo escrito se conserva para corregirlo.
    expect(within(dialog).getByLabelText('Valor')).toHaveValue('912345678');
  });

  it('cancelar cierra el formulario sin guardar', async () => {
    const user = userEvent.setup();
    render(<ContactManager />);
    await screen.findByText('Teléfono de atención');

    await user.click(screen.getByRole('button', { name: /Agregar canal/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.callsTo('POST', '/api/admin/contact-channels')).toHaveLength(0);
  });
});

describe('ContactManager: editar y eliminar', () => {
  it('editar abre el formulario con los datos del canal y guarda los cambios', async () => {
    api.on('PATCH /api/admin/contact-channels/:id', () => json({ channel: channels[0] }));
    const user = userEvent.setup();
    render(<ContactManager />);
    await screen.findByText('Teléfono de atención');

    await user.click(screen.getByRole('button', { name: 'Editar Teléfono de atención' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar canal de contacto' });
    expect(within(dialog).getByLabelText('Etiqueta')).toHaveValue('Teléfono de atención');
    expect(within(dialog).getByLabelText('Valor')).toHaveValue('+56 9 1234 5678');
    expect(within(dialog).getByLabelText(/Notas/)).toHaveValue('Lunes a viernes');
    expect(within(dialog).getByLabelText('Orden')).toHaveValue(1);

    await user.clear(within(dialog).getByLabelText('Etiqueta'));
    await user.type(within(dialog).getByLabelText('Etiqueta'), 'Teléfono principal');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(api.callsTo('PATCH', `/api/admin/contact-channels/${channels[0]!.id}`)).toHaveLength(1));
    expect(api.callsTo('PATCH', `/api/admin/contact-channels/${channels[0]!.id}`)[0]!.body).toMatchObject({
      type: 'phone',
      label: 'Teléfono principal',
      value: '+56 9 1234 5678',
      notes: 'Lunes a viernes',
      sortOrder: 1,
      isActive: true,
    });
  });

  it('eliminar pide confirmación y luego borra el canal', async () => {
    api.on('DELETE /api/admin/contact-channels/:id', () => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    render(<ContactManager />);
    await screen.findByText('Teléfono de atención');

    await user.click(screen.getByRole('button', { name: 'Eliminar Teléfono de atención' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('El asistente dejará de entregar este canal');
    expect(api.callsTo('DELETE', `/api/admin/contact-channels/${channels[0]!.id}`)).toHaveLength(0); // aún no

    await user.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.callsTo('DELETE', `/api/admin/contact-channels/${channels[0]!.id}`)).toHaveLength(1));
  });

  it('cancelar la eliminación no borra nada', async () => {
    const user = userEvent.setup();
    render(<ContactManager />);
    await screen.findByText('Teléfono de atención');

    await user.click(screen.getByRole('button', { name: 'Eliminar Teléfono de atención' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));

    expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });
});
