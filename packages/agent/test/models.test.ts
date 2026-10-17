import { EMBEDDING_DIMENSIONS } from '@fablab/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fabLabAgent } from '../src/agents/fablab-agent';
import { ConfigurationError, getChatEnv, getEmbeddingEnv } from '../src/env';
import { getChatModels, getChatModelSettings, MODEL_MAX_RETRIES } from '../src/models';

const REQUESTED_MODELS = ['openrouter/anthropic/claude-haiku-5.5', 'openrouter/openai/gpt-6-luna'];

const KEYS = ['NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'CHAT_MODELS', 'CHAT_MAX_OUTPUT_TOKENS', 'EMBEDDING_MODEL', 'EMBEDDING_DIMENSION'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.NVIDIA_API_KEY = 'nvapi-clave-de-prueba';
  process.env.OPENROUTER_API_KEY = 'sk-or-v1-clave-de-prueba';
  process.env.CHAT_MODELS = REQUESTED_MODELS.join(',');
  process.env.EMBEDDING_MODEL = 'org/modelo-de-embeddings';
  delete process.env.CHAT_MAX_OUTPUT_TOKENS;
  delete process.env.EMBEDDING_DIMENSION;
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('modelos de chat con respaldos', () => {
  it('devuelve los modelos en el orden de CHAT_MODELS, cada uno con sus reintentos', () => {
    expect(getChatModels()).toEqual(
      REQUESTED_MODELS.map((model) => ({ id: model, model, maxRetries: MODEL_MAX_RETRIES })),
    );
    expect(MODEL_MAX_RETRIES).toBeGreaterThan(0);
  });

  it('tolera espacios, comas sobrantes y entradas vacías', () => {
    process.env.CHAT_MODELS = ` ${REQUESTED_MODELS[0]} , ,${REQUESTED_MODELS[1]},, `;
    expect(getChatModels().map((m) => m.model)).toEqual([REQUESTED_MODELS[0], REQUESTED_MODELS[1]]);
  });

  it('funciona con un solo modelo (sin respaldos)', () => {
    process.env.CHAT_MODELS = REQUESTED_MODELS[0]!;
    expect(getChatModels()).toHaveLength(1);
  });

  it.each(['', '   ', ',,,', 'deepseek-v4', 'nvidia/', '/modelo', 'nvidia/ok,sin-proveedor'])(
    'rechaza CHAT_MODELS=%j con un error de configuración que nombra la variable',
    (value) => {
      process.env.CHAT_MODELS = value;
      expect(() => getChatEnv()).toThrow(ConfigurationError);
      expect(() => getChatEnv()).toThrow(/CHAT_MODELS/);
    },
  );

  it('sin modelos el error dice qué falta, sin filtrar valores', () => {
    delete process.env.CHAT_MODELS;
    expect(() => getChatEnv()).toThrow(ConfigurationError);
    expect(() => getChatEnv()).toThrow(/CHAT_MODELS/);
  });

  it('exige la clave de cada proveedor que aparece en CHAT_MODELS', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => getChatEnv()).toThrow(/OPENROUTER_API_KEY/);
    expect(() => getChatEnv()).not.toThrow(/NVIDIA_API_KEY/);

    process.env.CHAT_MODELS = 'openrouter/anthropic/claude-haiku-5.5,nvidia/deepseek-ai/deepseek-v4.1-flash';
    delete process.env.NVIDIA_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-clave-de-prueba';
    expect(() => getChatEnv()).toThrow(/NVIDIA_API_KEY/);
  });

  it('el chat con OpenRouter no necesita la clave de NVIDIA (solo los embeddings la usan)', () => {
    delete process.env.NVIDIA_API_KEY;
    expect(getChatEnv().CHAT_MODELS).toEqual(REQUESTED_MODELS);
  });

  it('el mensaje de error nunca incluye el valor de la clave', () => {
    process.env.CHAT_MODELS = 'sin-proveedor';
    expect(() => getChatEnv()).toThrow(expect.objectContaining({ message: expect.not.stringContaining('nvapi-clave-de-prueba') }));
  });
});

describe('parámetros de generación', () => {
  it('por defecto: temperatura 0,2 y 800 tokens de salida', () => {
    expect(getChatModelSettings()).toEqual({ temperature: 0.2, maxOutputTokens: 800 });
  });

  it('el tope de salida se puede subir para los modelos de razonamiento', () => {
    process.env.CHAT_MAX_OUTPUT_TOKENS = '2500';
    expect(getChatModelSettings().maxOutputTokens).toBe(2500);
  });

  it.each(['50', '999999', 'mucho'])('rechaza un tope inválido (%s)', (value) => {
    process.env.CHAT_MAX_OUTPUT_TOKENS = value;
    expect(() => getChatModelSettings()).toThrow(/CHAT_MAX_OUTPUT_TOKENS/);
  });
});

describe('agente real de Mastra', () => {
  it('resuelve los tres modelos pedidos como lista de respaldos, en orden y con reintentos', async () => {
    const list = await fabLabAgent.getModelList();

    expect(list).not.toBeNull();
    expect(list!.map((entry) => entry.id)).toEqual(REQUESTED_MODELS);
    expect(list!.map((entry) => entry.maxRetries)).toEqual(REQUESTED_MODELS.map(() => MODEL_MAX_RETRIES));
    expect(list!.every((entry) => entry.enabled)).toBe(true);
  });

  it('refleja un cambio de CHAT_MODELS sin reiniciar (se lee al usarse, no al importar)', async () => {
    process.env.CHAT_MODELS = `${REQUESTED_MODELS[1]},${REQUESTED_MODELS[0]}`;
    expect((await fabLabAgent.getModelList())!.map((entry) => entry.id)).toEqual([REQUESTED_MODELS[1], REQUESTED_MODELS[0]]);
  });

  it('aplica la temperatura, el tope de salida y los pasos máximos', async () => {
    process.env.CHAT_MAX_OUTPUT_TOKENS = '1200';
    const options = await fabLabAgent.getDefaultOptions();

    expect(options).toMatchObject({ maxSteps: 5, modelSettings: { temperature: 0.2, maxOutputTokens: 1200 } });
  });
});

describe('embeddings', () => {
  it('por defecto la dimensión es la de la columna vector', () => {
    expect(getEmbeddingEnv()).toMatchObject({ EMBEDDING_MODEL: 'org/modelo-de-embeddings', EMBEDDING_DIMENSION: EMBEDDING_DIMENSIONS });
    expect(EMBEDDING_DIMENSIONS).toBe(1024); // org/modelo-de-embeddings
  });

  it('rechaza una dimensión distinta a la de la columna y explica cómo cambiarla', () => {
    process.env.EMBEDDING_DIMENSION = '1536';
    expect(() => getEmbeddingEnv()).toThrow(ConfigurationError);
    expect(() => getEmbeddingEnv()).toThrow(/migrar la columna y reindexar/);
  });

  it('exige la clave y el modelo', () => {
    delete process.env.NVIDIA_API_KEY;
    delete process.env.EMBEDDING_MODEL;
    expect(() => getEmbeddingEnv()).toThrow(/NVIDIA_API_KEY/);
    expect(() => getEmbeddingEnv()).toThrow(/EMBEDDING_MODEL/);
  });
});
