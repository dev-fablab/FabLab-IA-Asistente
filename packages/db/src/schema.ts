import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

/**
 * Dimensión de los embeddings; debe coincidir con EMBEDDING_DIMENSION y con el modelo elegido
 * (`baai/bge-m3` de NVIDIA NIM: 1024). El índice HNSW de pgvector admite hasta 2000 dimensiones,
 * así que modelos de más dimensiones (por ejemplo nv-embed-v1, 4096) no se pueden indexar así.
 * Cambiarla exige una migración que vacíe `document_chunks` y reindexar todos los documentos.
 */
export const EMBEDDING_DIMENSIONS = 1024;

export const DOCUMENT_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const PROFILE_ROLES = ['admin', 'staff'] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    fullName: text('full_name'),
    role: text('role', { enum: PROFILE_ROLES }).notNull().default('staff'),
    createdAt: createdAt(),
  },
  // El rol se cambia con SQL: la restricción evita que un valor mal escrito deje a alguien sin rol válido.
  (t) => [check('profiles_role_check', sql`${t.role} in ('admin', 'staff')`)],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description'),
    fileName: text('file_name').notNull(),
    storagePath: text('storage_path').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentHash: text('content_hash'),
    status: text('status', { enum: DOCUMENT_STATUSES }).notNull().default('pending'),
    errorMessage: text('error_message'),
    chunkCount: integer('chunk_count').notNull().default(0),
    uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('documents_status_check', sql`${t.status} in ('pending', 'processing', 'ready', 'failed')`),
  ],
);

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    page: integer('page'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  (t) => [
    index('document_chunks_document_idx').on(t.documentId),
    index('document_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const CONTACT_CHANNEL_TYPES = ['phone', 'email', 'whatsapp', 'address', 'web', 'social'] as const;
export type ContactChannelType = (typeof CONTACT_CHANNEL_TYPES)[number];

export const contactChannels = pgTable('contact_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  label: text('label').notNull(),
  value: text('value').notNull(),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

export const conversations = pgTable(
  'conversations',
  {
    // El chat genera su propio UUID y lo envía en cada petición.
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: createdAt(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    firstMessage: text('first_message'),
    channel: text('channel', { enum: ['web', 'voice'] }).notNull().default('web'),
    messageCount: integer('message_count').notNull().default(0),
    hasNoAnswer: boolean('has_no_answer').notNull().default(false),
  },
  (t) => [index('conversations_last_message_idx').on(t.lastMessageAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    noAnswer: boolean('no_answer').notNull().default(false),
    modality: text('modality', { enum: ['text', 'voice'] }).notNull().default('text'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const MEETING_STATUSES = ['scheduled', 'cancelled', 'completed'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MINUTES_SOURCES = ['agent', 'staff'] as const;
export type MinutesSource = (typeof MINUTES_SOURCES)[number];

export const AVAILABILITY_EXCEPTION_KINDS = ['closed', 'open'] as const;
export type AvailabilityExceptionKind = (typeof AVAILABILITY_EXCEPTION_KINDS)[number];

/** Cómo llegó la persona a Fab Lab la primera vez (la etiqueta «medio» del panel). `chat` es lo que registra el asistente. */
export const CONTACT_SOURCES = ['chat', 'in_person', 'phone', 'whatsapp', 'email', 'social', 'other'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/**
 * Las personas que se relacionan con Fab Lab: las que piden una reunión por el chat y las que registra el equipo
 * (llegaron en persona, por teléfono, etc.). El nombre y el correo son siempre obligatorios y el correo identifica
 * a la persona (sin distinguir mayúsculas); otros medios de contacto van en `contact_methods`.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    source: text('source', { enum: CONTACT_SOURCES }).notNull().default('chat'),
    // Quién del equipo la registró; nulo cuando la creó el asistente desde el chat (o si esa persona sale del equipo).
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('contacts_email_lower_idx').on(sql`lower(${t.email})`),
    check('contacts_source_check', sql`${t.source} in ('chat', 'in_person', 'phone', 'whatsapp', 'email', 'social', 'other')`),
  ],
);

/** Otras formas de ubicar a una persona (teléfono, WhatsApp, redes...), además del correo. Mismos tipos que los canales de Fab Lab. */
export const contactMethods = pgTable(
  'contact_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    type: text('type', { enum: CONTACT_CHANNEL_TYPES }).notNull(),
    value: text('value').notNull(),
    // Orden en que se cargaron: los medios de una misma persona se guardan juntos y comparten `created_at`.
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('contact_methods_contact_idx').on(t.contactId),
    uniqueIndex('contact_methods_unique_idx').on(t.contactId, t.type, sql`lower(${t.value})`),
    check('contact_methods_type_check', sql`${t.type} in ('phone', 'email', 'whatsapp', 'address', 'web', 'social')`),
  ],
);

/**
 * Horario semanal base. `weekday` sigue `Date#getDay` (0 = domingo … 6 = sábado); las horas son minutos
 * desde la medianoche en la zona de Fab Lab. Un día puede tener varias ventanas.
 */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weekday: integer('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    check('availability_rules_weekday_check', sql`${t.weekday} between 0 and 6`),
    check(
      'availability_rules_window_check',
      sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);

/**
 * Cambios puntuales sobre el horario base. `closed` sin horas cierra el día entero (o la ventana indicada);
 * `open` agrega una ventana (obligatoria) a un día cualquiera.
 */
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind', { enum: AVAILABILITY_EXCEPTION_KINDS }).notNull(),
    startMinute: integer('start_minute'),
    endMinute: integer('end_minute'),
    note: text('note'),
  },
  (t) => [
    index('availability_exceptions_date_idx').on(t.date),
    check('availability_exceptions_kind_check', sql`${t.kind} in ('closed', 'open')`),
    check(
      'availability_exceptions_window_check',
      sql`(${t.startMinute} is null and ${t.endMinute} is null and ${t.kind} = 'closed')
        or (${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.startMinute} < ${t.endMinute})`,
    ),
  ],
);

/**
 * Reunión presencial en un bloque del calendario. El no solapamiento entre reuniones `scheduled` lo
 * garantiza una restricción de exclusión creada en SQL (ver la migración `0005`).
 */
export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    // La conversación que originó la reserva; si se borra, la reunión se conserva.
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    // Quien del equipo (staff o admin) lleva la reunión. Nace vacío: el agente no sabe quién atiende y el
    // equipo la asigna y la puede cambiar libremente. Si se borra la persona, la reunión queda sin responsable.
    responsibleId: uuid('responsible_id').references(() => profiles.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: MEETING_STATUSES }).notNull().default('scheduled'),
    reason: text('reason').notNull(),
    conversationSummary: text('conversation_summary'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meetings_starts_at_idx').on(t.startsAt),
    index('meetings_contact_idx').on(t.contactId),
    index('meetings_responsible_idx').on(t.responsibleId),
    check('meetings_status_check', sql`${t.status} in ('scheduled', 'cancelled', 'completed')`),
    check('meetings_range_check', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

/** Acta de la reunión: una fila por punto importante, que el agente prellena y el equipo edita. */
export const meetingMinutes = pgTable(
  'meeting_minutes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    source: text('source', { enum: MINUTES_SOURCES }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meeting_minutes_meeting_idx').on(t.meetingId, t.sortOrder),
    check('meeting_minutes_source_check', sql`${t.source} in ('agent', 'staff')`),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type ContactChannel = typeof contactChannels.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type ContactMethod = typeof contactMethods.$inferSelect;
export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type AvailabilityException = typeof availabilityExceptions.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type MeetingMinute = typeof meetingMinutes.$inferSelect;
