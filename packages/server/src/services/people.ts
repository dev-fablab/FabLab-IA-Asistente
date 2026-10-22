import { CONTACT_CHANNEL_TYPES, contactMethods, contacts, getDb, meetings, profiles, type ContactChannelType, type ContactSource } from '@fablab/db';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { normalizeChannelValue } from '../contact/validate';
import { badRequest, conflict, notFound } from '../errors';

export const PEOPLE_PAGE_SIZE = 25;
/** Cuántos medios de contacto adicionales puede tener una persona. */
export const MAX_CONTACT_METHODS = 10;

/** Escapa `%`, `_` y `\` para que la búsqueda se trate como texto literal en un LIKE. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Un instante agregado en SQL, como milisegundos: es más fiable que el texto que devuelve el driver para `min()` y `max()`. */
const epochMs = (expression: SQL) =>
  sql<number | null>`(extract(epoch from ${expression}) * 1000)::float8`.mapWith((value) => (value === null ? null : new Date(Number(value))));

/** Violación de una restricción única; drizzle envuelve el error de Postgres en `cause`. */
function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined);
  return code(error) === '23505' || code((error as { cause?: unknown } | null)?.cause) === '23505';
}

/**
 * Las personas que se relacionan con Fab Lab (las que piden una reunión por el chat y las que registra el equipo),
 * con cuántas reuniones llevan y cuándo es la próxima. Primero las que tienen una reunión por venir (la más
 * cercana arriba) y luego las demás, de la más reciente a la más antigua.
 */
export async function listPeople({ page, q, source }: { page: number; q?: string | undefined; source?: ContactSource | undefined }) {
  const db = getDb();
  const pattern = q ? `%${escapeLike(q)}%` : undefined;
  const where = and(
    pattern ? or(ilike(contacts.name, pattern), ilike(contacts.email, pattern)) : undefined,
    source ? eq(contacts.source, source) : undefined,
  );

  const upcoming = and(eq(meetings.status, 'scheduled'), sql`${meetings.endsAt} > now()`);
  const [{ total = 0 } = {}] = await db.select({ total: count() }).from(contacts).where(where);

  const items = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      source: contacts.source,
      createdAt: contacts.createdAt,
      // Las canceladas no cuentan: ya no ocupan el calendario ni se van a atender.
      meetingCount: sql<number>`(count(${meetings.id}) filter (where ${meetings.status} <> 'cancelled'))::int`,
      upcomingCount: sql<number>`(count(${meetings.id}) filter (where ${upcoming}))::int`,
      nextMeetingAt: epochMs(sql`min(${meetings.startsAt}) filter (where ${upcoming})`),
    })
    .from(contacts)
    .leftJoin(meetings, eq(meetings.contactId, contacts.id))
    .where(where)
    .groupBy(contacts.id)
    .orderBy(sql`min(${meetings.startsAt}) filter (where ${upcoming}) asc nulls last`, desc(contacts.createdAt))
    .limit(PEOPLE_PAGE_SIZE)
    .offset((page - 1) * PEOPLE_PAGE_SIZE);

  return { items, page, pageSize: PEOPLE_PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE)) };
}

/** Los medios de contacto adicionales de una persona, en el orden en que se cargaron. */
export async function listContactMethods(contactId: string) {
  return getDb()
    .select({ id: contactMethods.id, type: contactMethods.type, value: contactMethods.value })
    .from(contactMethods)
    .where(eq(contactMethods.contactId, contactId))
    .orderBy(asc(contactMethods.sortOrder), asc(contactMethods.id));
}

/** Una persona con sus medios de contacto y todas sus reuniones, la más reciente primero (incluye las canceladas, con su estado). */
export async function getPersonDetail(id: string) {
  const db = getDb();
  const [person] = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      source: contacts.source,
      createdAt: contacts.createdAt,
      createdById: contacts.createdBy,
      createdByName: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.email})`,
    })
    .from(contacts)
    .leftJoin(profiles, eq(contacts.createdBy, profiles.id))
    .where(eq(contacts.id, id));
  if (!person) throw notFound('Persona no encontrada');

  const rows = await db
    .select({
      id: meetings.id,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      status: meetings.status,
      reason: meetings.reason,
      responsibleId: meetings.responsibleId,
      responsibleName: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.email})`,
    })
    .from(meetings)
    .leftJoin(profiles, eq(meetings.responsibleId, profiles.id))
    .where(eq(meetings.contactId, id))
    .orderBy(desc(meetings.startsAt));

  return { person: { ...person, methods: await listContactMethods(id) }, meetings: rows };
}

export type MethodInput = { type: ContactChannelType; value: string };

export type PersonInput = {
  name: string;
  email: string;
  source: ContactSource;
  methods?: MethodInput[] | undefined;
};

/** El correo se valida como el de cualquier canal y se guarda en minúsculas: así lo busca el asistente. */
const normalizeEmail = (email: string) => normalizeChannelValue('email', email).toLowerCase();

/** Valida cada medio según su tipo y descarta los repetidos (mismo tipo y valor, sin distinguir mayúsculas). */
export function normalizeMethods(methods: MethodInput[], primaryEmail: string): MethodInput[] {
  if (methods.length > MAX_CONTACT_METHODS) throw badRequest(`Máximo ${MAX_CONTACT_METHODS} medios de contacto adicionales`);
  const seen = new Set<string>();
  const result: MethodInput[] = [];
  for (const method of methods) {
    if (!CONTACT_CHANNEL_TYPES.includes(method.type)) throw badRequest('Tipo de medio de contacto no válido');
    const value = normalizeChannelValue(method.type, method.value);
    const key = `${method.type}:${value.toLowerCase()}`;
    // El correo principal ya es un medio de contacto: repetirlo como adicional no agrega nada.
    if (seen.has(key) || (method.type === 'email' && value.toLowerCase() === primaryEmail)) continue;
    seen.add(key);
    result.push({ type: method.type, value });
  }
  return result;
}

/** Registra a una persona (la crea el equipo; el asistente las crea al agendar). El correo no puede repetirse. */
export async function createPerson(input: PersonInput, staffId: string) {
  const email = normalizeEmail(input.email);
  const methods = normalizeMethods(input.methods ?? [], email);
  try {
    const id = await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(contacts)
        .values({ name: input.name.trim(), email, source: input.source, createdBy: staffId })
        .returning({ id: contacts.id });
      if (methods.length > 0) await tx.insert(contactMethods).values(methods.map((method, index) => ({ contactId: created!.id, ...method, sortOrder: index })));
      return created!.id;
    });
    return getPersonDetail(id);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Ya existe una persona con ese correo');
    throw error;
  }
}

export type PersonPatch = Partial<Omit<PersonInput, 'methods'>> & { methods?: MethodInput[] | undefined };

/**
 * Edita a una persona. Con `methods` se reemplaza la lista completa de medios adicionales. Cambiar el correo
 * cambia cómo la reconoce el asistente, por eso no puede coincidir con el de otra persona.
 */
export async function updatePerson(id: string, patch: PersonPatch) {
  const db = getDb();
  const [current] = await db.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, id));
  if (!current) throw notFound('Persona no encontrada');

  const email = patch.email !== undefined ? normalizeEmail(patch.email) : current.email;
  const methods = patch.methods !== undefined ? normalizeMethods(patch.methods, email) : undefined;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({
          ...(patch.name !== undefined && { name: patch.name.trim() }),
          ...(patch.email !== undefined && { email }),
          ...(patch.source !== undefined && { source: patch.source }),
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id));
      if (methods) {
        await tx.delete(contactMethods).where(eq(contactMethods.contactId, id));
        if (methods.length > 0) await tx.insert(contactMethods).values(methods.map((method, index) => ({ contactId: id, ...method, sortOrder: index })));
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Ya existe una persona con ese correo');
    throw error;
  }
  return getPersonDetail(id);
}
