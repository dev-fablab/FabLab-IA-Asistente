import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '@/test/fetch-mock';
import { ConversationDetailView } from './conversation-detail';



const ID = '00000000-0000-4000-8000-000000000042';

const detail = {
  conversation: {
    id: ID,
    createdAt: '2026-10-17T14:00:00.000Z',
    lastMessageAt: '2026-10-17T14:05:00.000Z',
    firstMessage: '¿Cuánto cuesta?',
    channel: 'web',
    messageCount: 4,
    hasNoAnswer: true,
  },
  messages: [
    { id: 'm1', role: 'user', content: '¿Qué servicios ofrece?', noAnswer: false, modality: 'text', createdAt: '2026-10-17T14:00:00.000Z' },
    {
      id: 'm2',
      role: 'assistant',
      content: 'Según la guía, ofrece **impresión 3D** y:\n\n- corte láser\n- electrónica\n\nMás en [el sitio](https://fablab.cl).',
      noAnswer: false,
      modality: 'text',
      createdAt: '2026-10-17T14:00:05.000Z',
    },
    { id: 'm3', role: 'user', content: '¿Cuánto cuesta?', noAnswer: false, modality: 'text', createdAt: '2026-10-17T14:05:00.000Z' },
    { id: 'm4', role: 'assistant', content: 'No cuento con esa información.', noAnswer: true, modality: 'text', createdAt: '2026-10-17T14:05:04.000Z' },
  ],
};

let api: ReturnType<typeof mockApi>;

/** Los mensajes son los hijos directos de la lista (dentro de una respuesta puede haber listas Markdown). */
const messageItems = (thread: HTMLElement) => Array.from(thread.children) as HTMLElement[];

beforeEach(() => {
  api = mockApi();
  api.on(`GET /api/admin/conversations/${ID}`, () => json(detail));
});
afterEach(() => vi.unstubAllGlobals());

describe('ConversationDetailView', () => {
  it('muestra el hilo completo en orden, con rol y hora de cada mensaje', async () => {
    render(<ConversationDetailView id={ID} />);

    const thread = await screen.findByRole('list', { name: 'Mensajes de la conversación' });
    const items = messageItems(thread);
    expect(items).toHaveLength(4);
    expect(items.map((item) => (item.textContent ?? '').includes('Persona'))).toEqual([true, false, true, false]);
    expect(within(items[0]!).getByText('¿Qué servicios ofrece?')).toBeInTheDocument();
    expect(items.every((item) => item.querySelector('time'))).toBe(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Conversación' })).toBeInTheDocument();
    expect(screen.getByText('4 mensajes')).toBeInTheDocument();
    expect(screen.getByText('Canal: chat web')).toBeInTheDocument();
  });

  it('marca el mensaje «sin información» y la conversación', async () => {
    render(<ConversationDetailView id={ID} />);
    const thread = await screen.findByRole('list', { name: 'Mensajes de la conversación' });

    const items = messageItems(thread);
    expect(within(items[3]!).getByText('Sin información')).toBeInTheDocument();
    expect(within(items[1]!).queryByText('Sin información')).not.toBeInTheDocument();
    // La marca también aparece en el encabezado de la conversación.
    expect(screen.getAllByText('Sin información')).toHaveLength(2);
  });

  it('las respuestas del asistente se muestran con su formato Markdown y los enlaces abren aparte', async () => {
    render(<ConversationDetailView id={ID} />);
    const thread = await screen.findByRole('list', { name: 'Mensajes de la conversación' });

    expect(within(thread).getByText('impresión 3D', { selector: 'strong' })).toBeInTheDocument();
    expect(within(thread).getAllByRole('listitem').length).toBeGreaterThan(4); // los ítems de la lista Markdown
    expect(within(thread).queryByText(/\*\*/)).not.toBeInTheDocument();
    const link = within(thread).getByRole('link', { name: 'el sitio' });
    expect(link).toHaveAttribute('href', 'https://fablab.cl');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('no ejecuta HTML ni enlaces peligrosos que haya en una respuesta guardada', async () => {
    api.on(`GET /api/admin/conversations/${ID}`, () =>
      json({
        ...detail,
        messages: [
          {
            ...detail.messages[1]!,
            content: '<img src=x onerror="alert(1)"> <script>alert(2)</script> [clic](javascript:alert(3))',
          },
        ],
      }),
    );
    render(<ConversationDetailView id={ID} />);
    const thread = await screen.findByRole('list', { name: 'Mensajes de la conversación' });

    expect(thread.querySelector('img')).toBeNull();
    expect(thread.querySelector('script')).toBeNull();
    const link = within(thread).queryByRole('link', { name: 'clic' });
    expect(link === null || !(link.getAttribute('href') ?? '').toLowerCase().startsWith('javascript:')).toBe(true);
  });

  it('el texto de la persona se muestra tal cual, sin interpretarlo', async () => {
    api.on(`GET /api/admin/conversations/${ID}`, () =>
      json({ ...detail, messages: [{ ...detail.messages[0]!, content: '**no es negrita** <b>ni html</b>' }] }),
    );
    render(<ConversationDetailView id={ID} />);
    expect(await screen.findByText('**no es negrita** <b>ni html</b>')).toBeInTheDocument();
  });

  it('ofrece volver al historial', async () => {
    render(<ConversationDetailView id={ID} />);
    expect(await screen.findByRole('link', { name: /Volver al historial/ })).toHaveAttribute('href', '/admin/conversations');
  });

  it('una conversación inexistente muestra un mensaje claro y no ofrece reintentar', async () => {
    api.on(`GET /api/admin/conversations/${ID}`, () => json({ error: { code: 'not_found', message: 'Conversación no encontrada' } }, 404));
    render(<ConversationDetailView id={ID} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se encontró esta conversación.');
    expect(within(alert).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('un error del servidor permite reintentar', async () => {
    let fail = true;
    api.on(`GET /api/admin/conversations/${ID}`, () =>
      fail ? json({ error: { code: 'internal_error', message: 'Error interno' } }, 500) : json(detail),
    );
    const user = userEvent.setup();
    render(<ConversationDetailView id={ID} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error interno');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('list', { name: 'Mensajes de la conversación' });
  });
});
