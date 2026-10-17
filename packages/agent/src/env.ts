import { EMBEDDING_DIMENSIONS } from '@fablab/db';
import { z } from 'zod';

/** Variables de los modelos de embeddings (ingesta y búsqueda). */
const embeddingSchema = z.object({
  NVIDIA_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1),
  // Vacía equivale a no definida. Si se define, además de validarse contra la columna, se le pide
  // al modelo ese tamaño (los modelos Matryoshka de NVIDIA admiten reducir las dimensiones).
  EMBEDDING_DIMENSION: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  // Los modelos de recuperación de NIM (nemotron-embed…) son asimétricos: exigen `input_type`
  // (`passage` para documentos, `query` para preguntas) y sin él rinden mal o fallan con 400.
  EMBEDDING_ASYMMETRIC: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

/**
 * Lista de modelos de chat en orden de prioridad, separados por comas, en el formato del
 * enrutador de Mastra (`proveedor/modelo`). El primero es el principal y los demás son los
 * respaldos que se usan si falla (error 5xx, límite de tasa o tiempo agotado).
 */
const modelList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.string().regex(/^[^/\s]+\/\S+$/, 'cada modelo debe tener el formato proveedor/modelo'))
      .min(1, 'indica al menos un modelo'),
  );

/** Variables del agente de chat. */
const chatSchema = z.object({
  CHAT_MODELS: modelList,
  /** Tope de tokens de salida. Los modelos de razonamiento cuentan el razonamiento dentro de este tope. */
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(16_000).default(800),
});

/**
 * Variable con la clave de cada proveedor del enrutador de Mastra, que la lee del entorno por su cuenta.
 * Se exige la de cada proveedor que aparece en `CHAT_MODELS`; un proveedor que no está aquí no se comprueba.
 */
const PROVIDER_KEYS: Record<string, string> = { openrouter: 'OPENROUTER_API_KEY', nvidia: 'NVIDIA_API_KEY' };

/** Parámetros de recuperación (RAG); se calibran con el conjunto de evaluación. */
const retrievalSchema = z.object({
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.7),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().max(20).default(5),
});

/** Conexión del storage de Mastra: la misma base de Postgres que usa Drizzle, en otro esquema. */
const storageSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

/** La configuración del servidor falta o es inválida (variables de entorno). */
export class ConfigurationError extends Error {
  override name = 'ConfigurationError';
}

function parse<T extends z.ZodType>(schema: T, label: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
  throw new ConfigurationError(`Configuración incompleta o inválida para ${label}: revisa ${names}`);
}

export function getEmbeddingEnv() {
  const env = parse(embeddingSchema, 'los embeddings');
  if (env.EMBEDDING_DIMENSION !== undefined && env.EMBEDDING_DIMENSION !== EMBEDDING_DIMENSIONS) {
    throw new ConfigurationError(
      `EMBEDDING_DIMENSION (${env.EMBEDDING_DIMENSION}) no coincide con la columna vector (${EMBEDDING_DIMENSIONS}). ` +
        'Cambiar de dimensión exige migrar la columna y reindexar todos los documentos.',
    );
  }
  return {
    NVIDIA_API_KEY: env.NVIDIA_API_KEY,
    EMBEDDING_MODEL: env.EMBEDDING_MODEL,
    EMBEDDING_ASYMMETRIC: env.EMBEDDING_ASYMMETRIC,
    /** Dimensión esperada (la de la columna). */
    EMBEDDING_DIMENSION: EMBEDDING_DIMENSIONS,
    /** Solo se le pide al modelo un tamaño cuando se definió `EMBEDDING_DIMENSION` explícitamente. */
    requestDimensions: env.EMBEDDING_DIMENSION !== undefined,
  };
}

export function getChatEnv() {
  const env = parse(chatSchema, 'el chat');
  const missing = [...new Set(env.CHAT_MODELS.map((model) => PROVIDER_KEYS[model.split('/')[0]!]))].filter(
    (key): key is string => key !== undefined && !process.env[key],
  );
  if (missing.length > 0) {
    throw new ConfigurationError(`Configuración incompleta o inválida para el chat: revisa ${missing.join(', ')}`);
  }
  return env;
}

export function getRetrievalEnv() {
  return parse(retrievalSchema, 'la recuperación');
}

export function getStorageEnv() {
  return parse(storageSchema, 'el almacenamiento de Mastra');
}
