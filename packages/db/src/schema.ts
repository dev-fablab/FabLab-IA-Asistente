import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

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
const authTimestamp = (column: string) => timestamp(column, { withTimezone: true }).notNull().defaultNow();

/**
 * Tablas de Better Auth. Los nombres en plural coinciden con `usePlural` del adaptador.
 * La contraseña vive hasheada en `accounts.password` (proveedor `credential`).
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: authTimestamp('created_at'),
  updatedAt: authTimestamp('updated_at').$onUpdate(() => new Date()),
  role: text('role').default('staff'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: authTimestamp('created_at'),
    updatedAt: authTimestamp('updated_at').$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: authTimestamp('created_at'),
    updatedAt: authTimestamp('updated_at').$onUpdate(() => new Date()),
  },
  (t) => [index('accounts_user_idx').on(t.userId), uniqueIndex('accounts_provider_account_uidx').on(t.providerId, t.accountId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: authTimestamp('created_at'),
    updatedAt: authTimestamp('updated_at').$onUpdate(() => new Date()),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
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

export const PROJECT_TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];

export const PROJECT_TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type ProjectTaskPriority = (typeof PROJECT_TASK_PRIORITIES)[number];

export const PROJECT_MEMBER_ROLES = ['admin', 'member'] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

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

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('projects_person_idx').on(t.personId),
    index('projects_updated_at_idx').on(t.updatedAt),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role', { enum: PROJECT_MEMBER_ROLES }).notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('project_members_project_profile_idx').on(t.projectId, t.profileId),
    index('project_members_profile_idx').on(t.profileId),
    check('project_members_role_check', sql`${t.role} in ('admin', 'member')`),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: PROJECT_TASK_STATUSES }).notNull().default('todo'),
    priority: text('priority', { enum: PROJECT_TASK_PRIORITIES }).notNull().default('medium'),
    position: doublePrecision('position').notNull().default(0),
    dueDate: date('due_date', { mode: 'string' }),
    assigneeId: uuid('assignee_id').references(() => profiles.id, { onDelete: 'set null' }),
    assigneeName: text('assignee_name'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tasks_project_status_position_idx').on(t.projectId, t.status, t.position),
    index('tasks_project_parent_idx').on(t.projectId, t.parentId),
    index('tasks_assignee_idx').on(t.assigneeId),
    check('tasks_status_check', sql`${t.status} in ('todo', 'in_progress', 'done')`),
    check('tasks_priority_check', sql`${t.priority} in ('low', 'medium', 'high', 'urgent')`),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comments_task_created_idx').on(t.taskId, t.createdAt)],
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
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Comment = typeof comments.$inferSelect;
