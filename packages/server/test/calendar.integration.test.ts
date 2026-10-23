import { fabLabAgent, getAvailableSlots, scheduleMeeting } from '@fablab/agent';
import {
  addDaysToDate,
  availabilityExceptions,
  availabilityRules,
  bookMeeting,
  contacts,
  conversations,
  dateInTimeZone,
  getAvailability,
  getDb,
  instantAt,
  meetingMinutes,
  meetings,
  messages,
} from '@fablab/db';
import { RequestContext } from '@mastra/core/request-context';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createMemoryRateLimiter } from '../src/middleware/rate-limit';
import { createTestUser, fakeEmbedding, type TestUser } from './helpers/integration';
import { scriptedModel, type ScriptedStep } from './helpers/scripted-model';

vi.mock('@fablab/agent/embeddings', () => ({
  embedDocuments: async (texts: string[]) => texts.map((text) => fakeEmbedding(text)),
  embedQuery: async (text: string) => fakeEmbedding(text),
}));

const app = createApp({ basePath: '/api', rateLimiter: createMemoryRateLimiter() });
const TAG = `cal${Math.random().toString(36).slice(2, 8)}`;
const email = (name: string) => `${TAG}-${name}@fablab.test`;

const conversationIds: string[] = [];
const exceptionIds: string[] = [];
let originalRules: (typeof availabilityRules.$inferSelect)[];
let staff: TestUser;
let boss: TestUser;
/** Horarios libres de los próximos días, que cada prueba consume una sola vez. */
let slots: Date[] = [];
let cursor = 0;
const nextSlot = () => {
  const slot = slots[cursor++];
  if (!slot) throw new Error('No quedan horarios libres para la prueba');
  return slot;
};

/** Salida de una herramienta sin tipar: las pruebas comprueban los campos que importan. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const run = (tool: { execute?: (input: never, context: never) => unknown }, input: object, requestContext = new RequestContext()) =>
  tool.execute!(input as never, { requestContext } as never) as Promise<Json>;

async function newConversation() {
  const id = crypto.randomUUID();
  await getDb().insert(conversations).values({ id, firstMessage: 'Quiero agendar' });
  conversationIds.push(id);
  return id;
}

/** El cuerpo JSON de una respuesta, sin tipar: las pruebas comprueban los campos que importan. */
const jsonOf = async (res: Response): Promise<Json> => (await res.json()) as Json;

const admin = (method: string, path: string, body?: unknown) =>
  app.request(`/api/admin/calendar${path}`, {
    method,
    headers: { authorization: `Bearer ${staff.token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

const range = (slot: Date) => `from=${encodeURIComponent(new Date(slot.getTime() - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(slot.getTime() + 7_200_000).toISOString())}`;

beforeAll(async () => {
  process.env.NVIDIA_API_KEY ||= 'test-key-not-used';
  process.env.CHAT_MODELS ||= 'nvidia/test/not-used';

  originalRules = await getDb().select().from(availabilityRules);
  staff = await createTestUser('staff');
  boss = await createTestUser('admin');

  // Se toma un día por bloque para que las pruebas no dependan unas de otras.
  const from = addDaysToDate(dateInTimeZone(new Date()), 3);
  const { days } = await getAvailability({ from, days: 35 });
  slots = days.flatMap((day) => day.free.slice(2, 5).map((slot) => slot.start));
  expect(slots.length).toBeGreaterThan(20);
});

afterAll(async () => {
  const db = getDb();
  const owned = await db.select({ id: contacts.id }).from(contacts).where(like(contacts.email, `${TAG}-%`));
  if (owned.length > 0) {
    await db.delete(meetings).where(inArray(meetings.contactId, owned.map((c) => c.id)));
    await db.delete(contacts).where(inArray(contacts.id, owned.map((c) => c.id)));
  }
  if (exceptionIds.length > 0) await db.delete(availabilityExceptions).where(inArray(availabilityExceptions.id, exceptionIds));
  if (conversationIds.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, conversationIds));
    await db.delete(conversations).where(inArray(conversations.id, conversationIds));
  }
  // El horario base vuelve a su estado original aunque una prueba lo haya reemplazado.
  await db.delete(availabilityRules);
  if (originalRules.length > 0) await db.insert(availabilityRules).values(originalRules);
  await staff?.remove();
  await boss?.remove();
});

describe('bookMeeting', () => {
  it('crea el contacto nuevo, la reunión de una hora y el acta del agente', async () => {
    const startsAt = nextSlot();
    const result = await bookMeeting({
      email: `  ${email('Nuevo').toUpperCase()} `,
      name: 'Ana Pérez',
      reason: 'Imprimir un prototipo',
      startsAt,
      conversationSummary: 'Quiere imprimir una pieza',
      keyPoints: ['Necesita una pieza en PLA', '  ', 'Plazo: dos semanas'],
    });

    expect(result).toMatchObject({ status: 'booked', contactIsNew: true });
    if (result.status !== 'booked') return;
    expect(result.meeting.endsAt.getTime() - startsAt.getTime()).toBe(3_600_000);

    const [contact] = await getDb().select().from(contacts).where(eq(contacts.email, email('Nuevo').toLowerCase()));
    expect(contact).toMatchObject({ name: 'Ana Pérez' });
    const minutes = await getDb().select().from(meetingMinutes).where(eq(meetingMinutes.meetingId, result.meeting.id)).orderBy(meetingMinutes.sortOrder);
    expect(minutes.map((m) => [m.content, m.source])).toEqual([
      ['Necesita una pieza en PLA', 'agent'],
      ['Plazo: dos semanas', 'agent'],
    ]);
  });

  it('un correo existente reutiliza el contacto sin cambiarle el nombre', async () => {
    const first = await bookMeeting({ email: email('repite'), name: 'Luis Mora', reason: 'Primera visita', startsAt: nextSlot() });
    const second = await bookMeeting({ email: email('repite').toUpperCase(), name: 'Otro Nombre', reason: 'Segunda visita', startsAt: nextSlot() });

    expect(first).toMatchObject({ status: 'booked', contactIsNew: true });
    expect(second).toMatchObject({ status: 'booked', contactIsNew: false });
    const rows = await getDb().select().from(contacts).where(like(contacts.email, `${TAG}-repite%`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Luis Mora');
  });

  it('exige el nombre solo si el contacto es nuevo', async () => {
    expect(await bookMeeting({ email: email('sinnombre'), reason: 'Consulta', startsAt: nextSlot() })).toEqual({ status: 'name_required' });
  });

  it('dos reservas simultáneas del mismo bloque: solo una se concreta', async () => {
    const startsAt = nextSlot();
    const results = await Promise.all([
      bookMeeting({ email: email('carrera-a'), name: 'A', reason: 'Visita', startsAt }),
      bookMeeting({ email: email('carrera-b'), name: 'B', reason: 'Visita', startsAt }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['booked', 'slot_unavailable']);
    const booked = await getDb().select().from(meetings).where(eq(meetings.startsAt, startsAt));
    expect(booked.filter((m) => m.status === 'scheduled')).toHaveLength(1);
  });

  it('rechaza un horario fuera de la rejilla, del horario de atención o ya pasado', async () => {
    const slot = nextSlot();
    const offGrid = new Date(slot.getTime() + 30 * 60_000);
    const night = new Date(slot.getTime() - 12 * 3_600_000);
    const past = new Date(Date.now() - 86_400_000);

    for (const startsAt of [offGrid, night, past]) {
      expect(await bookMeeting({ email: email('fuera'), name: 'Fuera', reason: 'Visita', startsAt })).toEqual({ status: 'slot_unavailable' });
    }
    expect((await getDb().select().from(contacts).where(like(contacts.email, `${TAG}-fuera%`))).length).toBe(0);
  });

  it('limita las reuniones activas por correo y por conversación', async () => {
    const base = { name: 'Tope', reason: 'Visita' };
    await bookMeeting({ ...base, email: email('tope'), startsAt: nextSlot() });
    await bookMeeting({ ...base, email: email('tope'), startsAt: nextSlot() });
    expect(await bookMeeting({ ...base, email: email('tope'), startsAt: nextSlot() })).toEqual({ status: 'limit_reached', limit: 'contact' });

    const conversationId = await newConversation();
    await bookMeeting({ ...base, email: email('conv-1'), startsAt: nextSlot(), conversationId });
    await bookMeeting({ ...base, email: email('conv-2'), startsAt: nextSlot(), conversationId });
    expect(await bookMeeting({ ...base, email: email('conv-3'), startsAt: nextSlot(), conversationId })).toEqual({
      status: 'limit_reached',
      limit: 'conversation',
    });
  });
});

describe('herramientas del agente', () => {
  it('getAvailableSlots muestra el bloque como ocupado y no filtra datos de la persona', async () => {
    const startsAt = nextSlot();
    await bookMeeting({ email: email('privado'), name: 'Persona Privada', reason: 'Motivo reservado', startsAt });

    const from = dateInTimeZone(startsAt);
    const result = await run(getAvailableSlots, { from, days: 1 });
    const day = result.days[0];

    expect(day.free.map((s: { start: string }) => s.start)).not.toContain(startsAt.toISOString());
    expect(day.busy.map((s: { start: string }) => s.start)).toContain(startsAt.toISOString());
    expect(day.open).toEqual([{ start: '08:00', end: '20:00' }]);
    expect(JSON.stringify(result)).not.toMatch(/Persona Privada|Motivo reservado|privado@/);
    expect(day.free[0].label).toMatch(/de \d\d:\d\d a \d\d:\d\d/);
  });

  it('getAvailableSlots no ofrece nada un sábado sin excepción', async () => {
    let saturday = addDaysToDate(dateInTimeZone(new Date()), 1);
    while (new Date(`${saturday}T12:00:00Z`).getUTCDay() !== 6) saturday = addDaysToDate(saturday, 1);
    const day = (await run(getAvailableSlots, { from: saturday, days: 1 })).days[0];
    expect(day).toMatchObject({ open: [], free: [], weekday: 'sábado' });
  });

  it('scheduleMeeting pide primero el correo y después el nombre solo si es un contacto nuevo', async () => {
    const startsAt = nextSlot().toISOString();

    expect(await run(scheduleMeeting, {})).toEqual({ status: 'needs_info', missing: ['email', 'reason', 'startsAt'] });
    expect(await run(scheduleMeeting, { email: 'no-es-correo', reason: 'x', startsAt })).toMatchObject({
      status: 'needs_info',
      missing: ['email'],
      invalid: ['email'],
    });
    expect(await run(scheduleMeeting, { email: email('flujo'), reason: 'Visita', startsAt })).toEqual({
      status: 'needs_info',
      missing: ['name'],
      contact: 'new',
    });

    const booked = await run(scheduleMeeting, { email: email('flujo'), name: 'Flujo', reason: 'Visita', startsAt });
    expect(booked).toMatchObject({ status: 'booked', contact: 'new', meeting: { start: startsAt, reason: 'Visita' } });

    // El segundo pedido del mismo correo ya no necesita el nombre.
    const again = await run(scheduleMeeting, { email: email('flujo'), reason: 'Seguimiento', startsAt: nextSlot().toISOString() });
    expect(again).toMatchObject({ status: 'booked', contact: 'existing' });
  });

  it('scheduleMeeting no revela el nombre guardado ni acepta un horario inválido', async () => {
    const taken = nextSlot().toISOString();
    await run(scheduleMeeting, { email: email('dueno'), name: 'Dueña Secreta', reason: 'Visita', startsAt: taken });

    const clash = await run(scheduleMeeting, { email: email('otro'), name: 'Otro', reason: 'Visita', startsAt: taken });
    expect(clash.status).toBe('slot_unavailable');
    expect(clash.alternatives.length).toBeGreaterThan(0);
    expect(clash.alternatives.map((s: { start: string }) => s.start)).not.toContain(taken);

    const existing = await run(scheduleMeeting, { email: email('dueno'), reason: 'Otra', startsAt: 'mañana temprano' });
    expect(existing).toEqual({ status: 'needs_info', missing: ['startsAt'], invalid: ['startsAt'], contact: 'existing' });
    expect(JSON.stringify([clash, existing])).not.toContain('Dueña Secreta');
  });
});

describe('flujo completo desde el chat', () => {
  it('consulta horarios, pide los datos que faltan, agenda y deja la reunión lista para el panel', async () => {
    const startsAt = nextSlot().toISOString();
    const reservado = { email: email('chat'), reason: 'Quiero construir un robot', startsAt };
    const steps: ScriptedStep[] = [
      { tool: { name: 'getAvailableSlots', input: { days: 14 } } },
      { tool: { name: 'scheduleMeeting', input: reservado } },
      {
        tool: {
          name: 'scheduleMeeting',
          input: {
            ...reservado,
            name: 'Camila Rojas',
            conversationSummary: 'Camila quiere construir un robot para su ramo y necesita acceso a la cortadora láser.',
            keyPoints: ['Necesita un robot para su ramo', 'Requiere la cortadora láser'],
          },
        },
      },
      { text: 'Listo, quedó agendada tu reunión.' },
    ];
    fabLabAgent.__updateModel({ model: scriptedModel(steps) });

    const conversationId = crypto.randomUUID();
    conversationIds.push(conversationId);
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.77' },
      body: JSON.stringify({
        id: conversationId,
        messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Quiero agendar una reunión' }] }],
      }),
    });
    expect(res.status).toBe(200);

    const events = (await res.text())
      .split('\n')
      .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; output?: Json });
    const outputs = events.filter((e) => e.type === 'tool-output-available').map((e) => e.output!);

    expect(outputs[0]!.days.length).toBe(14);
    expect(outputs[1]).toEqual({ status: 'needs_info', missing: ['name'], contact: 'new' });
    expect(outputs[2]).toMatchObject({ status: 'booked', contact: 'new', meeting: { start: startsAt } });

    // Espera a que el chat termine de guardar sus mensajes antes de seguir con el panel.
    for (let attempt = 0; attempt < 50; attempt++) {
      const saved = await getDb().select().from(messages).where(eq(messages.conversationId, conversationId));
      if (saved.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // La reunión quedó ligada a la conversación y aparece en el panel con su resumen y su acta.
    const list = await jsonOf(await admin('GET', `/meetings?${range(new Date(startsAt))}`));
    const item = list.items.find((m: { reason: string }) => m.reason === 'Quiero construir un robot');
    expect(item).toMatchObject({ contactName: 'Camila Rojas', contactEmail: email('chat'), status: 'scheduled' });

    const detail = await jsonOf(await admin('GET', `/meetings/${item.id}`));
    expect(detail.meeting).toMatchObject({ conversationId, contact: { name: 'Camila Rojas' } });
    expect(detail.meeting.conversationSummary).toContain('cortadora láser');
    expect(detail.minutes.map((m: { content: string; source: string }) => [m.content, m.source])).toEqual([
      ['Necesita un robot para su ramo', 'agent'],
      ['Requiere la cortadora láser', 'agent'],
    ]);
  });
});

describe('rutas /admin/calendar', () => {
  async function bookedMeeting(name: string) {
    const startsAt = nextSlot();
    const result = await bookMeeting({ email: email(name), name, reason: `Motivo ${name}`, startsAt, keyPoints: ['Punto inicial'] });
    if (result.status !== 'booked') throw new Error(`No se pudo preparar la reunión: ${JSON.stringify(result)} ${startsAt.toISOString()}`);
    return { id: result.meeting.id, startsAt };
  }

  it('cancelar una reunión la quita del calendario y libera el horario; reactivarla lo vuelve a ocupar', async () => {
    const { id, startsAt } = await bookedMeeting('cancela');
    const from = dateInTimeZone(startsAt);
    const isFree = async () =>
      (await getAvailability({ from, days: 1 })).days[0]!.free.some((s) => s.start.getTime() === startsAt.getTime());

    expect(await isFree()).toBe(false);
    expect((await admin('PATCH', `/meetings/${id}`, { status: 'cancelled' })).status).toBe(200);
    expect((await jsonOf(await admin('GET', `/meetings?${range(startsAt)}`))).items.some((m: { id: string }) => m.id === id)).toBe(false);
    expect(await isFree()).toBe(true);

    // Otra persona toma el horario liberado: reactivar la cancelada ahora choca.
    await bookMeeting({ email: email('toma'), name: 'Toma', reason: 'Visita', startsAt });
    const res = await admin('PATCH', `/meetings/${id}`, { status: 'scheduled' });
    expect(res.status).toBe(409);
  });

  it('completar la reunión la deja visible', async () => {
    const { id, startsAt } = await bookedMeeting('completa');
    expect((await admin('PATCH', `/meetings/${id}`, { status: 'completed' })).status).toBe(200);
    const list = await jsonOf(await admin('GET', `/meetings?${range(startsAt)}`));
    expect(list.items.find((m: { id: string }) => m.id === id)).toMatchObject({ status: 'completed' });
  });

  it('el equipo agrega, edita y borra puntos del acta', async () => {
    const { id } = await bookedMeeting('acta');

    const created = await admin('POST', `/meetings/${id}/minutes`, { content: 'Se requiere permiso del departamento' });
    expect(created.status).toBe(201);
    const { minute } = await jsonOf(created);
    expect(minute).toMatchObject({ content: 'Se requiere permiso del departamento', source: 'staff' });

    expect((await admin('PATCH', `/minutes/${minute.id}`, { content: 'Permiso del departamento: en trámite' })).status).toBe(200);
    let detail = await jsonOf(await admin('GET', `/meetings/${id}`));
    expect(detail.minutes.map((m: { content: string }) => m.content)).toEqual(['Punto inicial', 'Permiso del departamento: en trámite']);

    expect((await admin('DELETE', `/minutes/${minute.id}`)).status).toBe(204);
    expect((await admin('DELETE', `/minutes/${minute.id}`)).status).toBe(404);
    detail = await jsonOf(await admin('GET', `/meetings/${id}`));
    expect(detail.minutes).toHaveLength(1);
    expect((await admin('POST', `/meetings/${id}/minutes`, { content: '   ' })).status).toBe(400);
  });

  it('acepta el rango con offset, como lo envía el calendario del panel', async () => {
    const res = await admin('GET', '/meetings?from=2026-10-19T00:00:00.000-03:00&to=2026-10-26T00:00:00.000-03:00');
    expect(res.status).toBe(200);
  });

  it('valida el rango de la consulta y el id de la reunión', async () => {
    expect((await admin('GET', '/meetings')).status).toBe(400);
    expect((await admin('GET', '/meetings?from=2026-10-20T00:00:00Z&to=2025-10-20T00:00:00Z')).status).toBe(400);
    expect((await admin('GET', '/meetings?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z')).status).toBe(400);
    expect((await admin('GET', '/meetings/no-es-uuid')).status).toBe(400);
    expect((await admin('GET', `/meetings/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it('el equipo cambia el horario base y el asistente lo ve de inmediato', async () => {
    const day = dateInTimeZone(slots[0]!);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();

    const overlap = await admin('PUT', '/availability/rules', {
      rules: [
        { weekday, startMinute: 480, endMinute: 720 },
        { weekday, startMinute: 600, endMinute: 900 },
      ],
    });
    expect(overlap.status).toBe(400);

    const updated = await admin('PUT', '/availability/rules', { rules: [{ weekday, startMinute: 600, endMinute: 720 }] });
    expect(updated.status).toBe(200);
    expect((await jsonOf(updated)).rules).toHaveLength(1);

    const found = (await getAvailability({ from: day, days: 1 })).days[0]!;
    expect(found.open).toEqual([{ startMinute: 600, endMinute: 720 }]);
    expect(found.free.length).toBeLessThanOrEqual(2);

    const config = await jsonOf(await admin('GET', '/availability'));
    expect(config).toMatchObject({ timeZone: 'America/Santiago', durationMinutes: 60 });
  });

  it('las excepciones cierran o abren días puntuales y se pueden quitar', async () => {
    // Restituye el horario base: la prueba anterior lo dejó con una sola ventana.
    await getDb().delete(availabilityRules);
    await getDb().insert(availabilityRules).values(originalRules);

    const day = dateInTimeZone(slots[slots.length - 1]!);
    const freeCount = async () => (await getAvailability({ from: day, days: 1 })).days[0]!.free.length;
    const before = await freeCount();
    expect(before).toBeGreaterThan(0);

    expect((await admin('POST', '/availability/exceptions', { date: day, kind: 'open' })).status).toBe(400);
    expect((await admin('POST', '/availability/exceptions', { date: '2026-02-30', kind: 'closed' })).status).toBe(400);

    const closed = await admin('POST', '/availability/exceptions', { date: day, kind: 'closed', note: 'Feriado' });
    expect(closed.status).toBe(201);
    const { exception } = await jsonOf(closed);
    exceptionIds.push(exception.id);
    expect(await freeCount()).toBe(0);

    expect((await admin('DELETE', `/availability/exceptions/${exception.id}`)).status).toBe(204);
    expect(await freeCount()).toBe(before);
    expect((await admin('DELETE', `/availability/exceptions/${exception.id}`)).status).toBe(404);
  });

  it('sin sesión de staff no hay acceso', async () => {
    const res = await app.request('/api/admin/calendar/meetings?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z');
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/calendar/availability/open-hours', () => {
  it('entrega las ventanas de cada día con las excepciones aplicadas', async () => {
    const monday = dateInTimeZone(slots[0]!);
    const res = await admin('GET', `/availability/open-hours?from=${monday}&to=${addDaysToDate(monday, 6)}`);
    expect(res.status).toBe(200);
    const { days } = await jsonOf(res);
    expect(days).toHaveLength(7);
    const weekdays = days.map((d: { date: string; open: unknown[] }) => [new Date(`${d.date}T12:00:00Z`).getUTCDay(), d.open.length > 0]);
    for (const [weekday, isOpen] of weekdays) expect(isOpen).toBe(weekday >= 1 && weekday <= 5);
    expect(days.find((d: { open: unknown[] }) => d.open.length > 0).open).toEqual([{ startMinute: 480, endMinute: 1200 }]);
  });

  it('valida el rango', async () => {
    expect((await admin('GET', '/availability/open-hours?from=2026-10-20&to=2026-10-19')).status).toBe(400);
    expect((await admin('GET', '/availability/open-hours?from=2026-01-01&to=2027-01-01')).status).toBe(400);
    expect((await admin('GET', '/availability/open-hours?from=hoy&to=mañana')).status).toBe(400);
  });
});

describe('el asistente sabe, en los turnos siguientes, qué quedó agendado', () => {
  let nextIp = 100;
  const post = async (id: string, thread: object[], script: ScriptedStep[]) => {
    const model = scriptedModel(script);
    fabLabAgent.__updateModel({ model });
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': `198.51.100.${nextIp++}` },
      body: JSON.stringify({ id, messages: thread }),
    });
    expect(res.status).toBe(200);
    await res.text(); // el stream debe terminar antes de mirar el prompt y la base de datos
    return JSON.stringify(model.doStreamCalls[0]!.prompt);
  };
  const user = (text: string) => ({ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] });
  // Como lo reenvía el navegador: el hilo trae el texto del asistente, sin sus herramientas.
  const assistant = (text: string) => ({ id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text }] });

  async function bookThroughChat(reason: string, name: string) {
    const conversationId = crypto.randomUUID();
    conversationIds.push(conversationId);
    const startsAt = nextSlot().toISOString();
    await post(conversationId, [user('Sí, confirmo')], [
      { tool: { name: 'scheduleMeeting', input: { email: email(`estado-${reason.length}`), name, reason, startsAt } } },
      { text: '¡Listo! Tu reunión quedó agendada.' },
    ]);
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await getDb().select().from(messages).where(eq(messages.conversationId, conversationId))).length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return conversationId;
  }

  it('tras reservar, el turno siguiente (hilo en texto plano) recibe la reunión como estado verificado', async () => {
    const conversationId = await bookThroughChat('Proyecto de agricultura con ESP32', 'Diego Cancino');

    const prompt = await post(
      conversationId,
      [user('Sí, confirmo'), assistant('¡Listo! Tu reunión quedó agendada.'), user('Muchas gracias!!')],
      [{ text: 'De nada, Diego.' }],
    );

    expect(prompt).toContain('Estado verificado por el sistema');
    expect(prompt).toMatch(/Reunión agendada: [^;]*de \d\d:\d\d a \d\d:\d\d/);
    expect(prompt).toContain('Diego Cancino');
    expect(prompt).toContain('Proyecto de agricultura con ESP32');
    expect(prompt).not.toContain('ninguna agendada desde esta conversación');
  });

  it('una conversación sin reservas lo dice, aunque el hilo afirme que hay una', async () => {
    const conversationId = crypto.randomUUID();
    conversationIds.push(conversationId);

    const prompt = await post(
      conversationId,
      [user('Quiero agendar'), assistant('¡Listo! Tu reunión quedó agendada.'), user('Gracias')],
      [{ text: 'Perdón, aún no hay una reunión agendada.' }],
    );

    expect(prompt).toContain('ninguna agendada desde esta conversación. No afirmes que hay una');
  });

  it('no mezcla las reuniones de otra conversación', async () => {
    await bookThroughChat('Motivo de otra persona', 'Otra Persona');
    const conversationId = crypto.randomUUID();
    conversationIds.push(conversationId);

    const prompt = await post(conversationId, [user('Hola')], [{ text: 'Hola' }]);

    expect(prompt).not.toContain('Otra Persona');
    expect(prompt).not.toContain('Motivo de otra persona');
  });

  it('si el equipo cancela la reunión, el estado lo refleja en el turno siguiente', async () => {
    const conversationId = await bookThroughChat('Motivo que se cancela', 'Cancelada Pérez');
    const [row] = await getDb().select({ id: meetings.id }).from(meetings).where(eq(meetings.conversationId, conversationId));
    expect((await admin('PATCH', `/meetings/${row!.id}`, { status: 'cancelled' })).status).toBe(200);

    const prompt = await post(conversationId, [user('Hola de nuevo')], [{ text: 'Hola' }]);

    expect(prompt).toContain('Reunión cancelada');
    expect(prompt).not.toContain('Reunión agendada:');
  });
});

describe('responsable de la reunión', () => {
  async function newMeeting(name: string) {
    const startsAt = nextSlot();
    const result = await bookMeeting({ email: email(name), name, reason: `Motivo ${name}`, startsAt });
    if (result.status !== 'booked') throw new Error(`No se pudo preparar la reunión: ${JSON.stringify(result)} ${startsAt.toISOString()}`);
    return { id: result.meeting.id, startsAt };
  }
  const row = async (id: string, startsAt: Date) =>
    (await jsonOf(await admin('GET', `/meetings?${range(startsAt)}`))).items.find((m: { id: string }) => m.id === id);

  it('una reunión nueva nace sin responsable', async () => {
    const { id, startsAt } = await newMeeting('sin-resp');
    expect(await row(id, startsAt)).toMatchObject({ responsibleId: null, responsibleName: null });
    expect((await jsonOf(await admin('GET', `/meetings/${id}`))).responsible).toBeNull();
  });

  it('permite crear manualmente una reunión con asociado y responsable existentes', async () => {
    const contactResult = await bookMeeting({ email: email('manual-contacto'), name: 'Manual Contacto', reason: 'Preparación', startsAt: nextSlot() });
    if (contactResult.status !== 'booked') throw new Error('No se pudo preparar el asociado');
    const startsAt = nextSlot();
    const response = await admin('POST', '/meetings', {
      contactId: (await getDb().select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email('manual-contacto'))))[0]!.id,
      responsibleId: staff.id,
      startsAt: startsAt.toISOString(),
      durationMinutes: 90,
      reason: 'Reunión creada por el equipo',
    });

    expect(response.status).toBe(201);
    const detail = await jsonOf(response);
    expect(detail.meeting).toMatchObject({ reason: 'Reunión creada por el equipo', conversationId: null });
    expect(detail.responsible).toMatchObject({ id: staff.id });
    expect(new Date(detail.meeting.endsAt).getTime() - new Date(detail.meeting.startsAt).getTime()).toBe(90 * 60_000);
    expect(
      (
        await admin('POST', '/meetings', {
          contactId: detail.meeting.contact.id,
          responsibleId: staff.id,
          startsAt: startsAt.toISOString(),
          reason: 'Horario repetido',
        })
      ).status,
    ).toBe(409);
  });

  it('el equipo la asigna a una persona de staff o admin y la puede cambiar libremente, también quitar', async () => {
    const { id, startsAt } = await newMeeting('asigna');

    // Staff se la asigna a sí mismo, luego se la pasa a un admin y después a nadie.
    expect((await admin('PATCH', `/meetings/${id}`, { responsibleId: staff.id })).status).toBe(200);
    expect(await row(id, startsAt)).toMatchObject({ responsibleId: staff.id, responsibleName: staff.email });
    expect((await jsonOf(await admin('GET', `/meetings/${id}`))).responsible).toMatchObject({ id: staff.id, role: 'staff' });

    const toAdmin = await admin('PATCH', `/meetings/${id}`, { responsibleId: boss.id });
    expect(toAdmin.status).toBe(200);
    expect((await jsonOf(toAdmin)).responsible).toMatchObject({ id: boss.id, role: 'admin', email: boss.email });

    expect((await admin('PATCH', `/meetings/${id}`, { responsibleId: null })).status).toBe(200);
    expect((await jsonOf(await admin('GET', `/meetings/${id}`))).responsible).toBeNull();
  });

  it('un admin también puede reasignar la reunión que lleva una persona de staff', async () => {
    const { id } = await newMeeting('admin-reasigna');
    await admin('PATCH', `/meetings/${id}`, { responsibleId: staff.id });
    const res = await app.request(`/api/admin/calendar/meetings/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${boss.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ responsibleId: boss.id }),
    });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).responsible).toMatchObject({ id: boss.id });
  });

  it('rechaza a quien no es parte del equipo y valida el cuerpo', async () => {
    const { id } = await newMeeting('invalido');
    expect((await admin('PATCH', `/meetings/${id}`, { responsibleId: crypto.randomUUID() })).status).toBe(400);
    expect((await admin('PATCH', `/meetings/${id}`, { responsibleId: 'no-es-uuid' })).status).toBe(400);
    expect((await admin('PATCH', `/meetings/${id}`, {})).status).toBe(400);
    expect((await admin('PATCH', `/meetings/${crypto.randomUUID()}`, { responsibleId: staff.id })).status).toBe(404);
  });

  it('si la persona sale del equipo, la reunión queda sin responsable y no se pierde', async () => {
    const leaving = await createTestUser('staff');
    const { id, startsAt } = await newMeeting('sale');
    await admin('PATCH', `/meetings/${id}`, { responsibleId: leaving.id });
    await leaving.remove();
    expect(await row(id, startsAt)).toMatchObject({ responsibleId: null });
  });

  it('GET /admin/team lista a todo el equipo con su rol', async () => {
    const { members } = await jsonOf(await app.request('/api/admin/team', { headers: { authorization: `Bearer ${staff.token}` } }));
    expect(members.find((m: { id: string }) => m.id === staff.id)).toMatchObject({ role: 'staff', email: staff.email });
    expect(members.find((m: { id: string }) => m.id === boss.id)).toMatchObject({ role: 'admin' });
  });
});

describe('reagendar una reunión', () => {
  async function newMeeting(name: string, startsAt = nextSlot()) {
    const result = await bookMeeting({ email: email(name), name, reason: `Motivo ${name}`, startsAt });
    if (result.status !== 'booked') throw new Error(`No se pudo preparar la reunión: ${JSON.stringify(result)} ${startsAt.toISOString()}`);
    return { id: result.meeting.id, startsAt };
  }
  const move = (id: string, to: Date) => admin('PATCH', `/meetings/${id}`, { startsAt: to.toISOString() });
  const startOf = async (id: string) => new Date((await jsonOf(await admin('GET', `/meetings/${id}`))).meeting.startsAt);

  it('mueve la reunión a otro horario de atención conservando la duración, y libera el anterior', async () => {
    const { id, startsAt } = await newMeeting('mueve');
    const date = dateInTimeZone(startsAt);
    const target = instantAt(date, 13 * 60); // 13:00, dentro del horario y sin choques

    const res = await move(id, target);
    expect(res.status).toBe(200);
    const detail = (await jsonOf(res)).meeting;
    expect(new Date(detail.startsAt).getTime()).toBe(target.getTime());
    expect(new Date(detail.endsAt).getTime() - target.getTime()).toBe(3_600_000);

    const day = (await getAvailability({ from: date, days: 1 })).days[0]!;
    expect(day.free.some((slot) => slot.start.getTime() === startsAt.getTime())).toBe(true);
    expect(day.busy.some((slot) => slot.start.getTime() === target.getTime())).toBe(true);
  });

  it('acepta un offset en la hora, como la envía el calendario del panel', async () => {
    const { id, startsAt } = await newMeeting('offset');
    const target = instantAt(dateInTimeZone(startsAt), 14 * 60 + 15);
    const res = await admin('PATCH', `/meetings/${id}`, { startsAt: new Date(target.getTime()).toISOString().replace('Z', '+00:00') });
    expect(res.status).toBe(200);
    expect((await startOf(id)).getTime()).toBe(target.getTime());
  });

  it('rechaza un bloque fuera del horario de atención o que se pasa del cierre', async () => {
    const { id, startsAt } = await newMeeting('fuera');
    const date = dateInTimeZone(startsAt);

    for (const minute of [7 * 60, 19 * 60 + 30, 21 * 60]) {
      const res = await move(id, instantAt(date, minute));
      expect(res.status, `minuto ${minute}`).toBe(400);
      expect((await jsonOf(res)).error.message).toMatch(/fuera del horario de atención/);
    }
    expect((await startOf(id)).getTime()).toBe(startsAt.getTime());
  });

  it('rechaza un día sin atención y respeta un cierre por excepción', async () => {
    const { id, startsAt } = await newMeeting('cerrado');
    let saturday = dateInTimeZone(startsAt);
    while (new Date(`${saturday}T12:00:00Z`).getUTCDay() !== 6) saturday = addDaysToDate(saturday, 1);
    expect((await move(id, instantAt(saturday, 10 * 60))).status).toBe(400);

    // Un día hábil lejano: el cierre no debe tocar los días de horarios que usan las demás pruebas.
    let other = addDaysToDate(dateInTimeZone(startsAt), 45);
    while ([0, 6].includes(new Date(`${other}T12:00:00Z`).getUTCDay())) other = addDaysToDate(other, 1);
    const closed = await jsonOf(await admin('POST', '/availability/exceptions', { date: other, kind: 'closed' }));
    exceptionIds.push(closed.exception.id);
    expect((await move(id, instantAt(other, 10 * 60))).status).toBe(400);
  });

  it('rechaza el pasado', async () => {
    const { id } = await newMeeting('pasado');
    const res = await move(id, new Date(Date.now() - 86_400_000));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error.message).toMatch(/pasado/);
  });

  it('rechaza el choque con otra reunión agendada, incluso parcial, pero permite quedar pegada', async () => {
    const first = await newMeeting('choca-a');
    const date = dateInTimeZone(first.startsAt);
    await newMeeting('choca-b', instantAt(date, 18 * 60)); // 18:00 a 19:00 del mismo día
    const clash = await move(first.id, instantAt(date, 18 * 60 + 30));
    expect(clash.status).toBe(409);
    expect((await jsonOf(clash)).error.message).toMatch(/ya lo ocupa otra reunión/);

    // Pegada al final de la otra (19:00 a 20:00) sí cabe.
    expect((await move(first.id, instantAt(date, 19 * 60))).status).toBe(200);
  });

  it('solo se mueven las agendadas: una realizada, cancelada o inexistente se rechaza', async () => {
    const done = await newMeeting('hecha');
    await admin('PATCH', `/meetings/${done.id}`, { status: 'completed' });
    expect((await move(done.id, instantAt(dateInTimeZone(done.startsAt), 8 * 60))).status).toBe(409);

    const cancelled = await newMeeting('cancelada');
    await admin('PATCH', `/meetings/${cancelled.id}`, { status: 'cancelled' });
    expect((await move(cancelled.id, instantAt(dateInTimeZone(cancelled.startsAt), 8 * 60))).status).toBe(409);

    expect((await move(crypto.randomUUID(), done.startsAt)).status).toBe(404);
  });

  it('moverla al mismo horario no falla', async () => {
    const { id, startsAt } = await newMeeting('igual');
    expect((await move(id, startsAt)).status).toBe(200);
  });

  it('puede cambiar el horario y el responsable en el mismo pedido', async () => {
    const { id, startsAt } = await newMeeting('ambos');
    const target = instantAt(dateInTimeZone(startsAt), 16 * 60);
    const res = await admin('PATCH', `/meetings/${id}`, { startsAt: target.toISOString(), responsibleId: staff.id });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(new Date(body.meeting.startsAt).getTime()).toBe(target.getTime());
    expect(body.responsible).toMatchObject({ id: staff.id });
  });

  it('un pedido rechazado no deja a medias el responsable', async () => {
    const { id, startsAt } = await newMeeting('atomico');
    const res = await admin('PATCH', `/meetings/${id}`, { startsAt: instantAt(dateInTimeZone(startsAt), 22 * 60).toISOString(), responsibleId: boss.id });
    expect(res.status).toBe(400);
    expect((await jsonOf(await admin('GET', `/meetings/${id}`))).responsible).toBeNull();
  });

  it('mover y reservar el mismo horario a la vez: solo uno lo consigue', async () => {
    const { id } = await newMeeting('carrera-mueve');
    const target = nextSlot();
    const [moved, booked] = await Promise.all([
      move(id, target),
      bookMeeting({ email: email('carrera-reserva'), name: 'Reserva', reason: 'Visita', startsAt: target }),
    ]);

    expect([moved.status === 200, booked.status === 'booked'].filter(Boolean)).toHaveLength(1);
  });

  it('el asistente ve el nuevo horario en el turno siguiente', async () => {
    const conversationId = crypto.randomUUID();
    await getDb().insert(conversations).values({ id: conversationId, firstMessage: 'Quiero agendar' });
    conversationIds.push(conversationId);
    const startsAt = nextSlot();
    const booked = await bookMeeting({ email: email('estado-mueve'), name: 'Estado Mueve', reason: 'Motivo estado mueve', startsAt, conversationId });
    if (booked.status !== 'booked') throw new Error(`No se pudo preparar la reunión: ${JSON.stringify(booked)}`);
    await move(booked.meeting.id, instantAt(dateInTimeZone(startsAt), 17 * 60 + 30));

    const model = scriptedModel([{ text: 'Hola' }]);
    fabLabAgent.__updateModel({ model });
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.201' },
      body: JSON.stringify({ id: conversationId, messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Hola' }] }] }),
    });
    await res.text();
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('de 17:30 a 18:30');
  });
});

describe('personas', () => {
  const find = async (query: string) => jsonOf(await admin('GET', `/people?${query}`));
  const book = async (name: string, startsAt: Date, who = name) => {
    const result = await bookMeeting({ email: email(who), name, reason: `Motivo ${name}`, startsAt });
    if (result.status !== 'booked') throw new Error(`No se pudo preparar la reunión: ${JSON.stringify(result)}`);
    return result.meeting.id;
  };

  it('lista a las personas con reuniones con cuántas llevan y cuándo es la próxima, sin contar las canceladas', async () => {
    const first = nextSlot();
    const second = nextSlot();
    const keep = await book('Soli Uno', second, 'soli-uno');
    const cancelled = await bookMeeting({ email: email('soli-uno'), name: 'Soli Uno', reason: 'Se cancela', startsAt: first });
    if (cancelled.status !== 'booked') throw new Error('No se pudo preparar la reunión');
    await admin('PATCH', `/meetings/${cancelled.meeting.id}`, { status: 'cancelled' });
    expect(keep).toBeDefined();

    const { items } = await find(`q=${TAG}-soli-uno`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Soli Uno', email: email('soli-uno'), meetingCount: 1, upcomingCount: 1 });
    expect(new Date(items[0].nextMeetingAt).getTime()).toBe(second.getTime());
  });

  it('una persona sin reuniones aparece con cero y sin próxima reunión', async () => {
    await getDb().insert(contacts).values({ name: 'Sin Reuniones', email: email('sin-reuniones') });
    const { items } = await find(`q=${TAG}-sin-reuniones`);
    expect(items[0]).toMatchObject({ name: 'Sin Reuniones', meetingCount: 0, upcomingCount: 0, nextMeetingAt: null });
  });

  it('primero quienes tienen una reunión por venir, la más cercana arriba, y al final los demás', async () => {
    const early = nextSlot();
    const late = nextSlot();
    await book('Orden Tarde', late, 'orden-tarde');
    await book('Orden Temprano', early, 'orden-temprano');
    await getDb().insert(contacts).values({ name: 'Orden Ninguna', email: email('orden-ninguna') });

    const { items } = await find(`q=${TAG}-orden`);
    expect(items.map((item: { name: string }) => item.name)).toEqual(['Orden Temprano', 'Orden Tarde', 'Orden Ninguna']);
  });

  it('busca por nombre o por correo sin distinguir mayúsculas y trata % y _ como texto', async () => {
    await book('María Búsqueda', nextSlot(), 'busqueda');
    expect((await find(`q=${encodeURIComponent('MARÍA BÚSQ')}`)).items.map((i: { name: string }) => i.name)).toContain('María Búsqueda');
    expect((await find(`q=${TAG.toUpperCase()}-BUSQUEDA`)).items).toHaveLength(1);
    expect((await find('q=%25')).items).toEqual([]);
    expect((await find('q=_')).items).toEqual([]);
  });

  it('pagina de a 25 y valida la página', async () => {
    const page = await find('page=1');
    expect(page).toMatchObject({ page: 1, pageSize: 25 });
    expect(page.items.length).toBeLessThanOrEqual(25);
    expect(page.totalPages).toBeGreaterThanOrEqual(1);
    expect((await admin('GET', '/people?page=0')).status).toBe(400);
    expect((await admin('GET', '/people?page=abc')).status).toBe(400);
  });

  it('el detalle trae todas sus reuniones, la más reciente primero, con estado y responsable', async () => {
    // El tope es de 2 reuniones activas por correo: la cancelada libera su lugar para las otras dos.
    const cancelledId = await book('Detalle Soli', nextSlot(), 'detalle');
    await admin('PATCH', `/meetings/${cancelledId}`, { status: 'cancelled' });
    await book('Detalle Soli', nextSlot(), 'detalle');
    const laterId = await book('Detalle Soli', nextSlot(), 'detalle');
    await admin('PATCH', `/meetings/${laterId}`, { responsibleId: staff.id });

    const [{ id }] = (await find(`q=${TAG}-detalle`)).items;
    const detail = await jsonOf(await admin('GET', `/people/${id}`));
    expect(detail.person).toMatchObject({ name: 'Detalle Soli', email: email('detalle'), source: 'chat', createdById: null, methods: [] });
    expect(detail.meetings).toHaveLength(3);
    const starts = detail.meetings.map((m: { startsAt: string }) => new Date(m.startsAt).getTime());
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
    expect(detail.meetings.map((m: { status: string }) => m.status)).toContain('cancelled');
    expect(detail.meetings.find((m: { id: string }) => m.id === laterId)).toMatchObject({ responsibleId: staff.id, responsibleName: staff.email });
  });

  it('un solicitante inexistente es 404 y un id inválido, 400', async () => {
    expect((await admin('GET', `/people/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await admin('GET', '/people/no-es-uuid')).status).toBe(400);
  });
});


describe('personas: registro por el equipo', () => {
  const find = async (query: string) => jsonOf(await admin('GET', `/people?${query}`));
  const create = (body: object, token = staff.token) =>
    app.request('/api/admin/calendar/people', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const base = (who: string, extra: object = {}) => ({ name: `Persona ${who}`, email: email(who), source: 'in_person', ...extra });

  it('el equipo registra a una persona con su medio y queda anotado quién la creó', async () => {
    const res = await create(base('crea'));
    expect(res.status).toBe(201);
    const { person, meetings: list } = await jsonOf(res);
    expect(person).toMatchObject({ name: 'Persona crea', email: email('crea'), source: 'in_person', createdById: staff.id, createdByName: staff.email, methods: [] });
    expect(list).toEqual([]);
    expect((await jsonOf(await admin('GET', `/people/${person.id}`))).person.id).toBe(person.id);
  });

  it('un admin también puede registrar personas', async () => {
    const res = await create(base('crea-admin', { source: 'phone' }), boss.token);
    expect(res.status).toBe(201);
    expect((await jsonOf(res)).person).toMatchObject({ source: 'phone', createdById: boss.id });
  });

  it('guarda el correo en minúsculas y recorta el nombre', async () => {
    const res = await create({ name: '  Con Espacios  ', email: `  ${email('Mayus').toUpperCase()}  `, source: 'other' });
    expect(res.status).toBe(201);
    expect((await jsonOf(res)).person).toMatchObject({ name: 'Con Espacios', email: email('Mayus').toLowerCase() });
  });

  it('el nombre y el correo son siempre obligatorios y el correo debe ser válido', async () => {
    expect((await create({ email: email('sin-nombre'), source: 'phone' })).status).toBe(400);
    expect((await create({ name: 'Sin Correo', source: 'phone' })).status).toBe(400);
    expect((await create({ name: '   ', email: email('espacios'), source: 'phone' })).status).toBe(400);
    expect((await create({ name: 'Mal Correo', email: 'no-es-correo', source: 'phone' })).status).toBe(400);
    expect((await create({ name: 'Medio Raro', email: email('medio-raro'), source: 'paloma' })).status).toBe(400);
    expect((await create({ name: 'Sin Medio', email: email('sin-medio') })).status).toBe(400);
  });

  it('no permite repetir el correo, ni con otras mayúsculas, y lo explica', async () => {
    expect((await create(base('repetida'))).status).toBe(201);
    const again = await create(base('repetida', { name: 'Otra Persona', email: email('REPETIDA') }));
    expect(again.status).toBe(409);
    expect((await jsonOf(again)).error.message).toBe('Ya existe una persona con ese correo');
  });

  it('guarda otros medios de contacto, validados por tipo, sin repetidos y sin repetir el correo principal', async () => {
    const res = await create(
      base('medios', {
        methods: [
          { type: 'phone', value: '+56 9 1234 5678' },
          { type: 'whatsapp', value: '+56 9 8765 4321' },
          { type: 'social', value: 'instagram.com/persona' },
          { type: 'phone', value: '+56 9 1234 5678' },
          { type: 'email', value: email('medios').toUpperCase() },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const { person } = await jsonOf(res);
    expect(person.methods.map((m: { type: string; value: string }) => [m.type, m.value])).toEqual([
      ['phone', '+56 9 1234 5678'],
      ['whatsapp', '+56 9 8765 4321'],
      ['social', 'https://instagram.com/persona'],
    ]);
  });

  it('rechaza un medio de contacto inválido y no deja a la persona creada a medias', async () => {
    const bad = await create(base('medio-malo', { methods: [{ type: 'phone', value: '12345' }] }));
    expect(bad.status).toBe(400);
    expect((await jsonOf(bad)).error.message).toMatch(/prefijo del país/);
    expect((await find(`q=${TAG}-medio-malo`)).items).toEqual([]);

    const tooMany = Array.from({ length: 11 }, (_, i) => ({ type: 'phone', value: `+56 9 1000 00${String(i).padStart(2, '0')}` }));
    expect((await create(base('muchos', { methods: tooMany }))).status).toBe(400);
  });

  it('edita el nombre, el correo, el medio y reemplaza la lista de medios adicionales', async () => {
    const { person } = await jsonOf(await create(base('edita', { methods: [{ type: 'phone', value: '+56 9 1111 2222' }] })));

    const res = await admin('PATCH', `/people/${person.id}`, {
      name: 'Nombre Nuevo',
      email: email('edita-nuevo'),
      source: 'whatsapp',
      methods: [{ type: 'whatsapp', value: '+56 9 3333 4444' }],
    });
    expect(res.status).toBe(200);
    const edited = (await jsonOf(res)).person;
    expect(edited).toMatchObject({ name: 'Nombre Nuevo', email: email('edita-nuevo'), source: 'whatsapp' });
    expect(edited.methods.map((m: { value: string }) => m.value)).toEqual(['+56 9 3333 4444']);

    // Sin `methods` la lista no se toca; con una lista vacía se quitan todos.
    expect((await jsonOf(await admin('PATCH', `/people/${person.id}`, { name: 'Solo Nombre' }))).person.methods).toHaveLength(1);
    expect((await jsonOf(await admin('PATCH', `/people/${person.id}`, { methods: [] }))).person.methods).toEqual([]);
  });

  it('no deja cambiar el correo al de otra persona y no modifica nada si falla', async () => {
    const { person: a } = await jsonOf(await create(base('dup-a')));
    const { person: b } = await jsonOf(await create(base('dup-b')));
    const clash = await admin('PATCH', `/people/${b.id}`, { name: 'No Debería Cambiar', email: a.email });
    expect(clash.status).toBe(409);
    expect((await jsonOf(await admin('GET', `/people/${b.id}`))).person).toMatchObject({ name: 'Persona dup-b', email: b.email });
    // Guardar con su propio correo sí se puede.
    expect((await admin('PATCH', `/people/${b.id}`, { email: b.email })).status).toBe(200);
  });

  it('valida el cuerpo de la edición', async () => {
    const { person } = await jsonOf(await create(base('valida')));
    expect((await admin('PATCH', `/people/${person.id}`, {})).status).toBe(400);
    expect((await admin('PATCH', `/people/${person.id}`, { email: 'no-es-correo' })).status).toBe(400);
    expect((await admin('PATCH', `/people/${person.id}`, { name: '  ' })).status).toBe(400);
    expect((await admin('PATCH', `/people/${crypto.randomUUID()}`, { name: 'X' })).status).toBe(404);
  });

  it('filtra la lista por medio', async () => {
    await create(base('f-presencial', { source: 'in_person' }));
    await create(base('f-telefono', { source: 'phone' }));
    const phone = await jsonOf(await admin('GET', `/people?source=phone&q=${TAG}-f-`));
    expect(phone.items.map((p: { email: string }) => p.email)).toEqual([email('f-telefono')]);
    expect((await admin('GET', '/people?source=paloma')).status).toBe(400);
  });

  it('el asistente reconoce a una persona registrada por el equipo: no le pide el nombre y no cambia su ficha', async () => {
    const { person } = await jsonOf(await create(base('agente', { name: 'Registrada Por Staff', source: 'phone' })));
    const startsAt = nextSlot().toISOString();

    expect(await run(scheduleMeeting, { email: email('agente'), reason: 'Seguimiento', startsAt })).toMatchObject({ status: 'booked', contact: 'existing' });

    const after = (await jsonOf(await admin('GET', `/people/${person.id}`))).person;
    expect(after).toMatchObject({ name: 'Registrada Por Staff', source: 'phone', createdById: staff.id });
  });

  it('una persona que agenda por el chat queda con medio «chat» y sin autor', async () => {
    const booked = await bookMeeting({ email: email('desde-chat'), name: 'Desde Chat', reason: 'Visita', startsAt: nextSlot() });
    if (booked.status !== 'booked') throw new Error('No se pudo preparar la reunión');
    const [{ id }] = (await jsonOf(await admin('GET', `/people?q=${TAG}-desde-chat`))).items;
    expect((await jsonOf(await admin('GET', `/people/${id}`))).person).toMatchObject({ source: 'chat', createdById: null, createdByName: null });
  });

  it('el detalle de la reunión muestra el medio y los demás medios de contacto de la persona', async () => {
    const { person } = await jsonOf(await create(base('detalle-reunion', { source: 'whatsapp', methods: [{ type: 'whatsapp', value: '+56 9 5555 6666' }] })));
    const result = await bookMeeting({ email: person.email, reason: 'Visita', startsAt: nextSlot() });
    if (result.status !== 'booked') throw new Error('No se pudo preparar la reunión');

    const { meeting } = await jsonOf(await admin('GET', `/meetings/${result.meeting.id}`));
    expect(meeting.contact).toMatchObject({ id: person.id, source: 'whatsapp' });
    expect(meeting.contact.methods.map((m: { type: string; value: string }) => [m.type, m.value])).toEqual([['whatsapp', '+56 9 5555 6666']]);
  });

  it('borrar al miembro del equipo que la registró no borra a la persona', async () => {
    const author = await createTestUser('staff');
    const res = await create(base('autor-sale'), author.token);
    const { person } = await jsonOf(res);
    await author.remove();
    expect((await jsonOf(await admin('GET', `/people/${person.id}`))).person).toMatchObject({ createdById: null, createdByName: null });
  });
});
