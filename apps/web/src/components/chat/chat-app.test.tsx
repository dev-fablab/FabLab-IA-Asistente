import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_STORAGE_KEY } from '@/lib/chat/conversation';
import { ChatApp } from './chat-app';

// Respuestas reales del servidor (modelo simulado), grabadas con `RECORD_CHAT_FIXTURES=1 pnpm test:integration`.
// Se usa una ruta y no `new URL(…, import.meta.url)`: en jsdom `URL` es la de jsdom y `fs` no la acepta.
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, '__fixtures__', `${name}.sse`), 'utf8');
const sse = (raw: string, status = 200) =>
  new Response(raw, { status, headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChatCall = { body: { id: string; messages: { role: string; parts: { text: string }[] }[]; trigger?: string } & Record<string, unknown> };

let chatHandler: (call: ChatCall) => Response | Promise<Response>;
let historyRows: { id: string; role: 'user' | 'assistant'; content: string }[] = [];
const channels = [{ type: 'phone', label: 'Teléfono', value: '+56 9 1234 5678', notes: null }];
const chatCalls: ChatCall[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  chatCalls.length = 0;
  historyRows = [];
  chatHandler = () => sse(fixture('answer-with-search'));

  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    if (url.pathname === '/api/chat' && init?.method === 'POST') {
      const call = { body: JSON.parse(String(init.body)) } as ChatCall;
      chatCalls.push(call);
      return chatHandler(call);
    }
    if (url.pathname === '/api/chat/history') return json({ messages: historyRows });
    if (url.pathname === '/api/chat/contact') return json({ channels });
    throw new Error(`fetch inesperado: ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openChat() {
  const user = userEvent.setup();
  render(<ChatApp />);
  await screen.findByText(/Soy el asistente virtual de Fab Lab/);
  return user;
}

const storedId = () => window.localStorage.getItem(CONVERSATION_STORAGE_KEY);

/** Stream que se detiene después del primer evento que cumpla la condición hasta llamar a `release`. */
function gatedStream(raw: string, stopAfter: (event: string) => boolean) {
  const events = raw.split('\n\n').filter(Boolean);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let gated = false;
      for (const event of events) {
        controller.enqueue(encoder.encode(`${event}\n\n`));
        if (!gated && stopAfter(event)) {
          gated = true;
          await gate;
        }
      }
      controller.close();
    },
  });
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } }),
    release: () => release(),
  };
}

describe('Chat: bienvenida', () => {
  it('muestra el saludo, las tres preguntas sugeridas y el aviso de privacidad', async () => {
    await openChat();

    expect(screen.getByRole('heading', { level: 1, name: 'Asistente de Fab Lab' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Preguntas sugeridas' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '¿Qué es Fab Lab?',
      '¿Qué servicios ofrece?',
      '¿Qué tipo de proyectos puedo solicitar?',
    ]);
    expect(screen.getByText(/las conversaciones se guardan; no compartas datos personales sensibles/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Escribe tu mensaje' })).toHaveAttribute('maxlength', '2000');
  });

  it('crea un UUID de conversación y lo guarda en el navegador', async () => {
    await openChat();
    expect(storedId()).toMatch(UUID);
  });
});

describe('Chat: enviar y recibir', () => {
  it('una pregunta sugerida se envía con el formato que espera la API y la respuesta se muestra con Markdown', async () => {
    const user = await openChat();
    const id = storedId();

    await user.click(screen.getByRole('button', { name: '¿Qué servicios ofrece?' }));

    await screen.findByText(/Según la guía de servicios/);
    expect(chatCalls).toHaveLength(1);
    const { body } = chatCalls[0]!;
    // Solo lo que la API espera: nada de `system` ni `tools` del cliente.
    expect(Object.keys(body).sort()).toEqual(['id', 'messages', 'trigger']);
    expect(body.id).toBe(id);
    expect(body.trigger).toBe('submit-message');
    expect(body.messages.at(-1)).toMatchObject({ role: 'user', parts: [{ text: '¿Qué servicios ofrece?' }] });

    // El Markdown de la respuesta se renderiza (negrita), no se muestra con asteriscos.
    expect(screen.getByText('impresión 3D', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    // La bienvenida desaparece al empezar la conversación.
    expect(screen.queryByText(/Soy el asistente virtual de Fab Lab/)).not.toBeInTheDocument();
  });

  it('se escribe en la caja de texto y se envía con Enter', async () => {
    const user = await openChat();
    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), '¿Cuál es el horario?{Enter}');

    await screen.findByText(/Según la guía de servicios/);
    expect(chatCalls[0]!.body.messages.at(-1)).toMatchObject({ role: 'user', parts: [{ text: '¿Cuál es el horario?' }] });
  });

  it('mientras corre searchDocuments muestra «Revisando la documentación…» y luego desaparece', async () => {
    const gated = gatedStream(fixture('answer-with-search'), (event) => event.includes('"tool-input-available"'));
    chatHandler = () => gated.response;
    const user = await openChat();

    await user.click(screen.getByRole('button', { name: '¿Qué es Fab Lab?' }));
    expect(await screen.findByText('Revisando la documentación…')).toBeInTheDocument();
    // Mientras responde se puede detener.
    expect(screen.getByRole('button', { name: 'Detener respuesta' })).toBeInTheDocument();

    gated.release();
    await screen.findByText(/Según la guía de servicios/);
    await waitFor(() => expect(screen.queryByText('Revisando la documentación…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toBeInTheDocument();
  });
});

describe('Chat: mascota', () => {
  // La del encabezado es la primera con `data-mood`; la del indicador de la respuesta vive en el `status`.
  const headerMood = () => document.querySelector('[data-mood]')?.getAttribute('data-mood');
  const indicator = () => screen.getByRole('status');
  const indicatorMood = () => indicator().querySelector('[data-mood]')?.getAttribute('data-mood');

  it('cambia de expresión según la etapa: escuchando, buscando y feliz al terminar', async () => {
    const gated = gatedStream(fixture('answer-with-search'), (event) => event.includes('"tool-input-available"'));
    chatHandler = () => gated.response;
    const user = await openChat();
    expect(headerMood()).toBe('idle');

    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), 'hola');
    expect(headerMood()).toBe('listening');

    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), '{Enter}');
    await screen.findByText('Revisando la documentación…');
    // Mientras responde, la mascota que reacciona es la del indicador; la del encabezado se queda en calma.
    await waitFor(() => expect(indicatorMood()).toBe('searching'));
    expect(headerMood()).toBe('idle');

    gated.release();
    await screen.findByText(/Según la guía de servicios/);
    await waitFor(() => expect(headerMood()).toBe('happy'));
  });

  it('el indicador dice qué hace el asistente y desaparece al terminar', async () => {
    const gated = gatedStream(fixture('answer-with-search'), (event) => event.includes('"tool-input-available"'));
    chatHandler = () => gated.response;
    const user = await openChat();
    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), 'hola{Enter}');

    // Antes de la herramienta, «Escribiendo…»; con la búsqueda en curso, el motivo concreto.
    expect(await within(indicator()).findByText('Revisando la documentación…')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);

    gated.release();
    await screen.findByText(/Según la guía de servicios/);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('si el asistente falla, la mascota se pone triste y el indicador desaparece', async () => {
    chatHandler = () => sse(fixture('stream-error'));
    const user = await openChat();
    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), 'hola{Enter}');

    await screen.findByRole('alert');
    await waitFor(() => expect(headerMood()).toBe('sad'));
    expect(screen.queryByText('Escribiendo…')).not.toBeInTheDocument();
  });

  it('es decorativa: no se anuncia a los lectores de pantalla', async () => {
    await openChat();
    expect(document.querySelector('[data-mood]')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Chat: tarjetas de herramientas', () => {
  it('getContactInfo muestra cada canal con enlaces tel: y mailto:', async () => {
    chatHandler = () => sse(fixture('contact-tool'));
    const user = await openChat();
    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), 'Quiero agendar una hora{Enter}');

    const card = await screen.findByRole('region', { name: 'Contacto de Fab Lab' });
    expect(within(card).getByRole('link', { name: '+56 9 1234 5678' })).toHaveAttribute('href', 'tel:+56912345678');
    expect(within(card).getByRole('link', { name: 'fablab@example.cl' })).toHaveAttribute('href', 'mailto:fablab@example.cl');
    expect(within(card).getByText('Responde en 24 h')).toBeInTheDocument();
    expect(screen.getByText(/Agendar aún no está disponible/)).toBeInTheDocument();
  });

  it('getDocumentLink muestra el documento con un botón «Descargar»', async () => {
    chatHandler = () => sse(fixture('document-link'));
    const user = await openChat();
    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), 'Pásame la guía{Enter}');

    const list = await screen.findByRole('list', { name: 'Documentos disponibles' });
    const download = within(list).getByRole('link', { name: /Descargar Guía de servicios/ });
    expect(download).toHaveAttribute('href', expect.stringContaining('/storage/v1/object/sign/documents/'));
    expect(download).toHaveAttribute('download', expect.stringMatching(/\.pdf$/));
    expect(within(list).getByText(/El enlace vence en 15 minutos/)).toBeInTheDocument();
  });
});

describe('Chat: errores', () => {
  it('al superar el límite de tasa muestra cuánto esperar y permite reintentar', async () => {
    chatHandler = (call) =>
      call.body.trigger === 'regenerate-message'
        ? sse(fixture('answer-with-search'))
        : json(
            { error: { code: 'rate_limited', message: 'Enviaste muchos mensajes seguidos. Podrás escribir de nuevo en 5 minutos.' } },
            429,
          );
    const user = await openChat();
    await user.click(screen.getByRole('button', { name: '¿Qué es Fab Lab?' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Podrás escribir de nuevo en 5 minutos.');
    // No hay que ofrecer contacto por un límite de tasa.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/chat/contact'))).toBe(false);

    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await screen.findByText(/Según la guía de servicios/);
    expect(chatCalls.at(-1)!.body.trigger).toBe('regenerate-message');
    expect(chatCalls.at(-1)!.body.id).toBe(chatCalls[0]!.body.id);
  });

  it('si el asistente falla muestra un mensaje claro con los canales de contacto', async () => {
    chatHandler = () => sse(fixture('stream-error'));
    const user = await openChat();
    await user.click(screen.getByRole('button', { name: '¿Qué es Fab Lab?' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El asistente no está disponible en este momento');
    // El detalle técnico no llega a la persona.
    expect(alert).not.toHaveTextContent(/proveedor|sk-or|Error:/);
    await within(alert).findByRole('link', { name: '+56 9 1234 5678' });
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('un mensaje inválido muestra el motivo y no ofrece reintentar el mismo texto', async () => {
    chatHandler = () => json({ error: { code: 'bad_request', message: 'El mensaje es demasiado largo (máximo 2.000 caracteres)' } }, 400);
    const user = await openChat();
    await user.click(screen.getByRole('button', { name: '¿Qué es Fab Lab?' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El mensaje es demasiado largo');
    expect(within(alert).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('sin conexión muestra un mensaje de red', async () => {
    chatHandler = () => {
      throw new TypeError('Failed to fetch');
    };
    const user = await openChat();
    await user.click(screen.getByRole('button', { name: '¿Qué es Fab Lab?' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar');
  });
});

describe('Chat: retomar y reiniciar', () => {
  it('al recargar retoma la conversación guardada con sus mensajes (RF-09)', async () => {
    const id = '3f6d2c0e-8b1a-4c5d-9e7f-2a4b6c8d0e1f';
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
    historyRows = [
      { id: '1', role: 'user', content: '¿Qué es Fab Lab?' },
      { id: '2', role: 'assistant', content: 'Fab Lab es un laboratorio de fabricación digital.' },
    ];

    render(<ChatApp />);

    await screen.findByText('Fab Lab es un laboratorio de fabricación digital.');
    expect(screen.getByText('¿Qué es Fab Lab?')).toBeInTheDocument();
    expect(screen.queryByText(/Soy el asistente virtual de Fab Lab/)).not.toBeInTheDocument();
    expect(storedId()).toBe(id);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`conversationId=${id}`))).toBe(true);
  });

  it('al seguir la conversación retomada se usa el mismo identificador', async () => {
    const id = '3f6d2c0e-8b1a-4c5d-9e7f-2a4b6c8d0e1f';
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
    historyRows = [
      { id: '1', role: 'user', content: 'Hola' },
      { id: '2', role: 'assistant', content: 'Hola, ¿en qué te ayudo?' },
    ];
    const user = userEvent.setup();
    render(<ChatApp />);
    await screen.findByText('Hola, ¿en qué te ayudo?');

    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), '¿Qué servicios hay?{Enter}');
    await screen.findByText(/Según la guía de servicios/);

    expect(chatCalls[0]!.body.id).toBe(id);
    // El hilo enviado incluye lo ya conversado.
    expect(chatCalls[0]!.body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('un identificador guardado inválido se descarta y se crea uno nuevo', async () => {
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, 'no-es-un-uuid');
    await (async () => {
      render(<ChatApp />);
      await screen.findByText(/Soy el asistente virtual de Fab Lab/);
    })();
    expect(storedId()).toMatch(UUID);
    expect(storedId()).not.toBe('no-es-un-uuid');
  });

  it('si el historial no se puede leer empieza de cero con el mismo identificador', async () => {
    const id = '3f6d2c0e-8b1a-4c5d-9e7f-2a4b6c8d0e1f';
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });

    render(<ChatApp />);
    await screen.findByText(/Soy el asistente virtual de Fab Lab/);
    expect(storedId()).toBe(id);
  });

  it('«Nueva conversación» crea otro identificador y limpia el hilo', async () => {
    const user = await openChat();
    const first = storedId();
    await user.click(screen.getByRole('button', { name: '¿Qué es Fab Lab?' }));
    await screen.findByText(/Según la guía de servicios/);

    await user.click(screen.getByRole('button', { name: /Nueva conversación/ }));

    await screen.findByText(/Soy el asistente virtual de Fab Lab/);
    expect(screen.queryByText(/Según la guía de servicios/)).not.toBeInTheDocument();
    expect(storedId()).toMatch(UUID);
    expect(storedId()).not.toBe(first);

    // La siguiente pregunta viaja con el identificador nuevo.
    await user.click(screen.getByRole('button', { name: '¿Qué servicios ofrece?' }));
    await waitFor(() => expect(chatCalls).toHaveLength(2));
    expect(chatCalls[1]!.body.id).toBe(storedId());
    expect(chatCalls[1]!.body.id).not.toBe(chatCalls[0]!.body.id);
    expect(chatCalls[1]!.body.messages).toHaveLength(1);
  });
});

describe('Chat: scroll desde cualquier parte', () => {
  const wheel = (target: Element, init: WheelEventInit) => target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, ...init }));

  it('la rueda sobre la barra superior o las franjas laterales desplaza el hilo', async () => {
    await openChat();
    const viewport = screen.getByRole('log', { name: 'Conversación con el asistente' });
    const scrollBy = vi.fn();
    viewport.scrollBy = scrollBy as typeof viewport.scrollBy;

    wheel(screen.getByRole('banner'), { deltaY: 120 });
    wheel(document.body, { deltaY: -50 });
    expect(scrollBy).toHaveBeenNthCalledWith(1, { top: 120, behavior: 'instant' });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { top: -50, behavior: 'instant' });
  });

  it('convierte líneas y páginas a píxeles, y no interfiere con el zoom ni con el scroll del propio hilo', async () => {
    await openChat();
    const viewport = screen.getByRole('log', { name: 'Conversación con el asistente' });
    const scrollBy = vi.fn();
    viewport.scrollBy = scrollBy as typeof viewport.scrollBy;

    wheel(document.body, { deltaY: 3, deltaMode: 1 });
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 48, behavior: 'instant' });

    scrollBy.mockClear();
    wheel(document.body, { deltaY: 100, ctrlKey: true }); // zoom del navegador
    wheel(viewport, { deltaY: 100 }); // el navegador ya lo desplaza
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
