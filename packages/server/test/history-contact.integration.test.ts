import { contactChannels, conversations, getDb, messages } from '@fablab/db';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTestUser, type TestUser } from './helpers/integration';

const app = createApp({ basePath: '/api' });
const TAG = `hc-${Math.random().toString(36).slice(2, 8)}`;

let staff: TestUser;

const call = async (method: string, path: string, body?: unknown) =>
  app.request(`/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${staff.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

type ListBody = {
  items: { id: string; firstMessage: string | null; messageCount: number; hasNoAnswer: boolean; lastMessageAt: string }[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const list = async (query: Record<string, string>) => {
  const res = await call('GET', `/conversations?${new URLSearchParams({ q: TAG, ...query })}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
};

async function addConversation(options: {
  suffix: string;
  lastMessageAt: Date;
  hasNoAnswer?: boolean;
  extra?: { role: 'user' | 'assistant'; content: string; noAnswer?: boolean }[];
}) {
  const db = getDb();
  const [conversation] = await db
    .insert(conversations)
    .values({
      firstMessage: `${TAG} ${options.suffix}`,
      lastMessageAt: options.lastMessageAt,
      createdAt: options.lastMessageAt,
      hasNoAnswer: options.hasNoAnswer ?? false,
      messageCount: 2 + (options.extra?.length ?? 0),
    })
    .returning();
  const base = options.lastMessageAt.getTime();
  const rows = [
    { role: 'user' as const, content: `${TAG} ${options.suffix}`, noAnswer: false },
    { role: 'assistant' as const, content: `Respuesta a ${options.suffix}`, noAnswer: options.hasNoAnswer ?? false },
    ...(options.extra ?? []).map((m) => ({ noAnswer: false, ...m })),
  ];
  await db.insert(messages).values(
    rows.map((row, index) => ({ conversationId: conversation!.id, createdAt: new Date(base + index * 1000), ...row })),
  );
  return conversation!.id;
}

beforeAll(async () => {
  staff = await createTestUser('staff');
});

afterAll(async () => {
  const db = getDb();
  await db.delete(conversations).where(like(conversations.firstMessage, `${TAG}%`));
  await db.delete(contactChannels).where(like(contactChannels.label, `${TAG}%`));
  await staff?.remove();
});

describe('GET /api/admin/conversations', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    // 27 conversaciones, de la más antigua (n00) a la más reciente (n26), para probar la paginación.
    const start = Date.UTC(2026, 0, 10, 12, 0, 0);
    for (let i = 0; i < 27; i++) {
      const suffix = `n${String(i).padStart(2, '0')}`;
      ids[suffix] = await addConversation({
        suffix,
        lastMessageAt: new Date(start + i * 60_000),
        // Las conversaciones n03 y n20 tienen respuestas «sin información».
        hasNoAnswer: i === 3 || i === 20,
      });
    }
  });

  it('lista 25 por página, las más recientes primero, con los datos de la fila', async () => {
    const page1 = await list({});
    expect(page1).toMatchObject({ page: 1, pageSize: 25, total: 27, totalPages: 2 });
    expect(page1.items).toHaveLength(25);
    expect(page1.items[0]).toMatchObject({ firstMessage: `${TAG} n26`, messageCount: 2, hasNoAnswer: false });
    expect(page1.items.map((i) => i.firstMessage).slice(0, 3)).toEqual([`${TAG} n26`, `${TAG} n25`, `${TAG} n24`]);

    const times = page1.items.map((i) => new Date(i.lastMessageAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('la segunda página trae el resto sin repetir', async () => {
    const page2 = await list({ page: '2' });
    expect(page2.items.map((i) => i.firstMessage)).toEqual([`${TAG} n01`, `${TAG} n00`]);
    expect((await list({ page: '3' })).items).toEqual([]);
  });

  it('filtra las conversaciones «sin información» (RF-21)', async () => {
    const result = await list({ noAnswer: 'true' });
    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.firstMessage)).toEqual([`${TAG} n20`, `${TAG} n03`]);
    expect(result.items.every((i) => i.hasNoAnswer)).toBe(true);
    expect((await list({ noAnswer: 'false' })).total).toBe(27);
  });

  it('busca dentro de los mensajes, no solo en la primera pregunta (RF-22)', async () => {
    const id = await addConversation({
      suffix: 'busqueda',
      lastMessageAt: new Date(Date.UTC(2026, 0, 11)),
      extra: [{ role: 'user', content: 'Quisiera saber del taller de ceramica' }],
    });
    const found = await call('GET', `/conversations?q=${encodeURIComponent('taller de ceramica')}`);
    expect(((await found.json()) as ListBody).items.map((i) => i.id)).toContain(id);

    const insensitive = await call('GET', `/conversations?q=${encodeURIComponent('TALLER DE CERAMICA')}`);
    expect(((await insensitive.json()) as ListBody).items.map((i) => i.id)).toContain(id);
  });

  it('% y _ se buscan como texto, no como comodines', async () => {
    const id = await addConversation({
      suffix: 'porcentaje',
      lastMessageAt: new Date(Date.UTC(2026, 0, 12)),
      extra: [{ role: 'user', content: 'Hay un descuento del 100% para estudiantes' }],
    });
    const percent = (await (await call('GET', `/conversations?q=${encodeURIComponent('100%')}`)).json()) as ListBody;
    expect(percent.items.map((i) => i.id)).toContain(id);

    // Un `%` suelto no coincide con todo: solo con lo que contiene un % literal.
    const lone = (await (await call('GET', `/conversations?q=${encodeURIComponent(`${TAG} %`)}`)).json()) as ListBody;
    expect(lone.total).toBe(0);
    const underscore = (await (await call('GET', `/conversations?q=${encodeURIComponent(`${TAG}_n0`)}`)).json()) as ListBody;
    expect(underscore.total).toBe(0);
  });

  it('el rango de fechas usa los días de Chile (America/Santiago), también con horario de verano e invierno', async () => {
    // Marzo: Chile está en UTC-3. 02:30 UTC del 10 es 23:30 del día 9 en Santiago.
    const verano = await addConversation({ suffix: 'tz-verano-9', lastMessageAt: new Date('2026-03-10T02:30:00Z') });
    // 03:30 UTC del 10 es 00:30 del día 10 en Santiago.
    const verano10 = await addConversation({ suffix: 'tz-verano-10', lastMessageAt: new Date('2026-03-10T03:30:00Z') });
    // Julio: Chile está en UTC-4. 03:30 UTC del 10 es 23:30 del día 9.
    const invierno = await addConversation({ suffix: 'tz-invierno-9', lastMessageAt: new Date('2026-07-10T03:30:00Z') });

    const idsOf = async (query: Record<string, string>) => (await list({ q: `${TAG} tz-`, ...query })).items.map((i) => i.id);

    expect(await idsOf({ from: '2026-03-09', to: '2026-03-09' })).toEqual([verano]);
    expect(await idsOf({ from: '2026-03-10', to: '2026-03-10' })).toEqual([verano10]);
    expect(await idsOf({ from: '2026-03-09', to: '2026-03-10' })).toEqual([verano10, verano]);
    expect(await idsOf({ from: '2026-07-09', to: '2026-07-09' })).toEqual([invierno]);
    expect(await idsOf({ from: '2026-07-10', to: '2026-07-10' })).toEqual([]);
    // Solo `from` o solo `to`.
    expect(await idsOf({ from: '2026-07-01' })).toEqual([invierno]);
    expect(await idsOf({ to: '2026-03-09' })).toEqual([verano]);
  });

  it('combina filtros', async () => {
    const result = await list({ noAnswer: 'true', from: '2026-01-10', to: '2026-01-10', q: `${TAG} n03` });
    expect(result.items.map((i) => i.firstMessage)).toEqual([`${TAG} n03`]);
  });

  it('rechaza parámetros inválidos con 400', async () => {
    for (const query of ['page=0', 'page=abc', 'from=10-03-2026', 'to=mañana', 'from=2026-03-10&to=2026-03-09', `q=${'a'.repeat(201)}`, 'noAnswer=si']) {
      const res = await call('GET', `/conversations?${query}`);
      expect(res.status, query).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'bad_request' } });
    }
  });

  it('el historial es de solo lectura: no hay rutas para borrar ni editar', async () => {
    const id = ids.n00!;
    expect((await call('DELETE', `/conversations/${id}`)).status).toBe(404);
    expect((await call('PATCH', `/conversations/${id}`, { firstMessage: 'x' })).status).toBe(404);
    expect((await call('POST', '/conversations', {})).status).toBe(404);
    expect(((await list({})) as ListBody).total).toBeGreaterThanOrEqual(27);
  });
});

describe('GET /api/admin/conversations/:id', () => {
  it('devuelve el hilo completo en orden, con la hora y la marca «sin información»', async () => {
    const id = await addConversation({
      suffix: 'detalle',
      lastMessageAt: new Date('2026-02-01T15:00:00Z'),
      hasNoAnswer: true,
      extra: [
        { role: 'user', content: 'Otra pregunta' },
        { role: 'assistant', content: 'Esa sí la sé', noAnswer: false },
      ],
    });

    const res = await call('GET', `/conversations/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversation: { id: string; messageCount: number; hasNoAnswer: boolean; channel: string };
      messages: { role: string; content: string; noAnswer: boolean; createdAt: string }[];
    };

    expect(body.conversation).toMatchObject({ id, messageCount: 4, hasNoAnswer: true, channel: 'web' });
    expect(body.messages.map((m) => [m.role, m.noAnswer])).toEqual([
      ['user', false],
      ['assistant', true],
      ['user', false],
      ['assistant', false],
    ]);
    expect(body.messages[0]!.content).toBe(`${TAG} detalle`);
    const times = body.messages.map((m) => new Date(m.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('responde 404 si no existe y 400 si el id está mal formado', async () => {
    expect((await call('GET', `/conversations/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await call('GET', '/conversations/no-es-uuid')).status).toBe(400);
  });
});

describe('/api/admin/contact-channels', () => {
  type Channel = { id: string; type: string; label: string; value: string; notes: string | null; sortOrder: number; isActive: boolean };
  const create = (body: object) => call('POST', '/contact-channels', body);
  const channelsList = async () => ((await (await call('GET', '/contact-channels')).json()) as { channels: Channel[] }).channels.filter((c) => c.label.startsWith(TAG));

  it('crea, edita, lista en orden y elimina un canal', async () => {
    const res = await create({ type: 'phone', label: `${TAG} Teléfono`, value: '+56 9 1234 5678', notes: 'Lunes a viernes', sortOrder: 5 });
    expect(res.status).toBe(201);
    const { channel } = (await res.json()) as { channel: Channel };
    expect(channel).toMatchObject({ type: 'phone', value: '+56 9 1234 5678', notes: 'Lunes a viernes', sortOrder: 5, isActive: true });

    const second = (await (await create({ type: 'email', label: `${TAG} Correo`, value: 'fablab@inacap.cl', sortOrder: 1 })).json()) as { channel: Channel };
    expect((await channelsList()).map((c) => c.label)).toEqual([`${TAG} Correo`, `${TAG} Teléfono`]);

    const patched = await call('PATCH', `/contact-channels/${channel.id}`, { label: `${TAG} Teléfono principal`, sortOrder: 0, isActive: false });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { channel: Channel }).channel).toMatchObject({
      label: `${TAG} Teléfono principal`,
      value: '+56 9 1234 5678',
      sortOrder: 0,
      isActive: false,
    });
    expect((await channelsList()).map((c) => c.label)).toEqual([`${TAG} Teléfono principal`, `${TAG} Correo`]);

    expect((await call('DELETE', `/contact-channels/${channel.id}`)).status).toBe(204);
    expect((await call('DELETE', `/contact-channels/${channel.id}`)).status).toBe(404);
    expect((await channelsList()).map((c) => c.id)).toEqual([second.channel.id]);
  });

  it('valida el valor según el tipo y explica el motivo', async () => {
    const before = (await channelsList()).length;
    const cases: [object, RegExp][] = [
      [{ type: 'email', label: `${TAG} x`, value: 'no-es-correo' }, /correo/],
      [{ type: 'phone', label: `${TAG} x`, value: '912345678' }, /prefijo del país/],
      [{ type: 'whatsapp', label: `${TAG} x`, value: '56912345678' }, /prefijo del país/],
      [{ type: 'web', label: `${TAG} x`, value: 'javascript:alert(1)' }, /dirección web/],
      [{ type: 'address', label: `${TAG} x`, value: 'ab' }, /demasiado corta/],
    ];
    for (const [body, message] of cases) {
      const res = await create(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(message);
    }
    // Las peticiones inválidas no crean nada.
    expect(await channelsList()).toHaveLength(before);
  });

  it('normaliza las direcciones web sin esquema y trata las notas vacías como ausentes', async () => {
    const res = await create({ type: 'social', label: `${TAG} Instagram`, value: 'instagram.com/fablab', notes: '   ' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { channel: Channel }).channel).toMatchObject({ value: 'https://instagram.com/fablab', notes: null });
  });

  it('al editar valida el registro resultante: cambiar solo el tipo o solo el valor puede ser inválido', async () => {
    const { channel } = (await (await create({ type: 'phone', label: `${TAG} Cambio`, value: '+56 9 1234 5678' })).json()) as { channel: Channel };

    // Un teléfono no es un correo: cambiar solo el tipo falla.
    const typeOnly = await call('PATCH', `/contact-channels/${channel.id}`, { type: 'email' });
    expect(typeOnly.status).toBe(400);
    // Cambiar solo el valor a algo inválido para su tipo actual falla.
    expect((await call('PATCH', `/contact-channels/${channel.id}`, { value: 'sin prefijo 123456789' })).status).toBe(400);
    // Cambiar ambos a la vez es válido.
    const both = await call('PATCH', `/contact-channels/${channel.id}`, { type: 'email', value: 'otro@fablab.cl' });
    expect(both.status).toBe(200);
    expect(((await both.json()) as { channel: Channel }).channel).toMatchObject({ type: 'email', value: 'otro@fablab.cl' });
    // El canal quedó intacto tras los intentos fallidos.
    expect((await channelsList()).find((c) => c.id === channel.id)).toMatchObject({ type: 'email', value: 'otro@fablab.cl' });
  });

  it('rechaza cuerpos inválidos y recursos inexistentes', async () => {
    expect((await create({ type: 'otro', label: `${TAG} x`, value: 'x' })).status).toBe(400);
    expect((await create({ type: 'email', label: '', value: 'a@b.cl' })).status).toBe(400);
    expect((await create({ type: 'email', label: `${TAG} x` })).status).toBe(400);

    const { channel } = (await (await create({ type: 'web', label: `${TAG} Web`, value: 'https://fablab.cl' })).json()) as { channel: Channel };
    expect((await call('PATCH', `/contact-channels/${channel.id}`, {})).status).toBe(400);
    expect((await call('PATCH', `/contact-channels/${crypto.randomUUID()}`, { label: 'x' })).status).toBe(404);
    expect((await call('PATCH', '/contact-channels/no-es-uuid', { label: 'x' })).status).toBe(400);
  });

  it('el agente y el chat público solo ven los canales activos, en el orden del equipo', async () => {
    await create({ type: 'email', label: `${TAG} Activo B`, value: 'b@fablab.cl', sortOrder: 2 });
    await create({ type: 'email', label: `${TAG} Activo A`, value: 'a@fablab.cl', sortOrder: 1 });
    await create({ type: 'email', label: `${TAG} Inactivo`, value: 'x@fablab.cl', sortOrder: 0, isActive: false });

    const admin = await channelsList();
    expect(admin.some((c) => c.label === `${TAG} Inactivo`)).toBe(true);

    const pub = (await (await app.request('/api/chat/contact', { headers: { 'x-real-ip': '198.51.100.99' } })).json()) as { channels: { label: string }[] };
    const mine = pub.channels.filter((c) => c.label.startsWith(TAG)).map((c) => c.label);
    expect(mine).not.toContain(`${TAG} Inactivo`);
    expect(mine.indexOf(`${TAG} Activo A`)).toBeLessThan(mine.indexOf(`${TAG} Activo B`));
  });
});
