import { createOpenAI } from '@ai-sdk/openai';
import { getChatEnv, getEmbeddingEnv } from './env';

/** Endpoint OpenAI-compatible de NVIDIA NIM (el catálogo de la API de NVIDIA). */
export const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/** Reintentos de cada modelo antes de pasar al siguiente de la lista. */
export const MODEL_MAX_RETRIES = 2;

/** Un embedding de un fragmento de documento o de una pregunta de la persona. */
export type EmbeddingKind = 'document' | 'query';

type FetchArgs = Parameters<typeof fetch>;

/**
 * El esquema de embeddings de OpenAI no tiene `input_type` ni siempre `dimensions`, pero NIM los usa:
 * se agregan al cuerpo de la solicitud. Sin campos extra se usa el `fetch` por defecto.
 */
function withBodyFields(fields: Record<string, unknown>) {
  if (Object.keys(fields).length === 0) return undefined;
  return (input: FetchArgs[0], init?: FetchArgs[1]) => {
    const body = typeof init?.body === 'string' ? JSON.stringify({ ...JSON.parse(init.body), ...fields }) : init?.body;
    return globalThis.fetch(input, { ...init, body });
  };
}

/**
 * Los endpoints de NIM son compatibles con OpenAI: un único cliente apuntado a NIM sirve para los
 * embeddings (y, en la Fase 2, para STT y TTS si se usan modelos de NVIDIA).
 */
function nvidia(kind: EmbeddingKind) {
  const env = getEmbeddingEnv();
  const fetch = withBodyFields({
    ...(env.EMBEDDING_ASYMMETRIC && { input_type: kind === 'query' ? 'query' : 'passage' }),
    ...(env.requestDimensions && { dimensions: env.EMBEDDING_DIMENSION }),
  });

  return createOpenAI({
    baseURL: NVIDIA_NIM_BASE_URL,
    apiKey: env.NVIDIA_API_KEY,
    name: 'nvidia',
    ...(fetch && { fetch }),
  });
}

/** Modelo de embeddings; el nombre sale de EMBEDDING_MODEL, nunca del código. */
export function getEmbeddingModel(kind: EmbeddingKind = 'document') {
  return nvidia(kind).embedding(getEmbeddingEnv().EMBEDDING_MODEL);
}

/** Una entrada de la lista de modelos de chat, en la forma que Mastra espera para los respaldos. */
export type ChatModelEntry = { id: string; model: string; maxRetries: number };

/**
 * Modelos de chat en orden de prioridad (`CHAT_MODELS`). Mastra intenta el primero y, si falla
 * (error 5xx, límite de tasa, tiempo agotado) y agota sus reintentos, pasa al siguiente. Los
 * identificadores usan el formato del enrutador de Mastra (`openrouter/<organización>/<modelo>`) y
 * Mastra toma la clave del proveedor del entorno (`OPENROUTER_API_KEY`; ver `getChatEnv`).
 */
export function getChatModels(): ChatModelEntry[] {
  return getChatEnv().CHAT_MODELS.map((model) => ({ id: model, model, maxRetries: MODEL_MAX_RETRIES }));
}

/** Parámetros de generación del agente. El tope de salida es configurable por los modelos de razonamiento. */
export function getChatModelSettings() {
  return { temperature: 0.2, maxOutputTokens: getChatEnv().CHAT_MAX_OUTPUT_TOKENS } as const;
}
