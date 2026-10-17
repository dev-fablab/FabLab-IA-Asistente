import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
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

export type Profile = typeof profiles.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type ContactChannel = typeof contactChannels.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
