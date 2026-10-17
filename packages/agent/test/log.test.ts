import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, redact, serializeError, withLogContext } from '../src/log';
import { MastraJsonLogger } from '../src/mastra-logger';

type Entry = Record<string, unknown>;

let lines: Entry[];
const KEYS = ['LOG_LEVEL', 'NVIDIA_API_KEY', 'DATABASE_URL'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  delete process.env.LOG_LEVEL;
  lines = [];
  const capture = (line: string) => {
    lines.push(JSON.parse(line));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('nivel de registro', () => {
  it('por defecto muestra info, warn y error pero no debug', () => {
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(lines.map((line) => line.event)).toEqual(['b', 'c', 'd']);
  });

  it('LOG_LEVEL=debug muestra todo y warn deja solo warn y error', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.debug('a');
    expect(lines).toHaveLength(1);

    lines = [];
    process.env.LOG_LEVEL = 'warn';
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(lines.map((line) => line.event)).toEqual(['c', 'd']);
  });

  it('LOG_LEVEL=silent lo apaga y un valor desconocido vuelve al nivel por defecto', () => {
    process.env.LOG_LEVEL = 'silent';
    logger.error('a');
    expect(lines).toEqual([]);

    process.env.LOG_LEVEL = 'ruidoso';
    logger.info('b');
    expect(lines.map((line) => line.event)).toEqual(['b']);
  });

  it('escribe una línea JSON con nivel, evento y hora', () => {
    logger.info('algo.paso', { n: 1 });
    expect(lines[0]).toMatchObject({ level: 'info', event: 'algo.paso', n: 1 });
    expect(new Date(lines[0]!.time as string).toString()).not.toBe('Invalid Date');
  });

  it('un campo que no se puede serializar no lanza', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.info('circular', { circular })).not.toThrow();
    expect(lines[0]).toMatchObject({ event: 'circular', logError: expect.any(String) });
  });
});

describe('contexto de la petición', () => {
  it('añade los campos del contexto a todo lo que se registra dentro, también tras un await', async () => {
    await withLogContext({ requestId: 'req-1' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.info('dentro');
    });
    logger.info('fuera');
    expect(lines[0]).toMatchObject({ event: 'dentro', requestId: 'req-1' });
    expect(lines[1]).not.toHaveProperty('requestId');
  });

  it('un child creado dentro de la petición conserva su requestId cuando se usa después', async () => {
    const child = withLogContext({ requestId: 'req-2' }, () => logger.child({ conversationId: 'c-1' }));
    await Promise.resolve();
    child.info('tarde');
    expect(lines[0]).toMatchObject({ event: 'tarde', requestId: 'req-2', conversationId: 'c-1' });
  });

  it('peticiones simultáneas no se mezclan', async () => {
    await Promise.all(
      ['a', 'b'].map((id) =>
        withLogContext({ requestId: id }, async () => {
          await new Promise((resolve) => setTimeout(resolve, id === 'a' ? 5 : 1));
          logger.info('fin', { id });
        }),
      ),
    );
    for (const line of lines) expect(line.requestId).toBe(line.id);
  });
});

describe('serializeError', () => {
  it('conserva lo que explica un fallo del proveedor y la cadena de causas', () => {
    const cause = Object.assign(new Error('Gone'), { statusCode: 410, responseBody: '{"detail":"model removed"}' });
    const error = Object.assign(new Error('Cannot connect to API'), {
      name: 'AI_APICallError',
      url: 'https://integrate.api.nvidia.com/v1/chat/completions?key=secreto',
      isRetryable: false,
      cause,
    });

    expect(serializeError(error)).toMatchObject({
      name: 'AI_APICallError',
      message: 'Cannot connect to API',
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      isRetryable: false,
      cause: { message: 'Gone', statusCode: 410, responseBody: '{"detail":"model removed"}' },
    });
  });

  it('no copia el cuerpo de la solicitud ni las cabeceras, que llevan la conversación y la clave', () => {
    const error = Object.assign(new Error('falló'), {
      requestBodyValues: { messages: [{ content: 'mi pregunta privada' }] },
      responseHeaders: { authorization: 'Bearer nvapi-abcdefghijkl' },
    });
    const text = JSON.stringify(serializeError(error));
    expect(text).not.toContain('mi pregunta privada');
    expect(text).not.toContain('authorization');
  });

  it('oculta la clave configurada, los tokens y las credenciales de la conexión en mensajes y cuerpos', () => {
    process.env.NVIDIA_API_KEY = 'clave-con-otro-formato-123';
    process.env.DATABASE_URL = 'postgresql://postgres:contrasena-db@localhost:54322/postgres';
    const error = Object.assign(
      new Error('401 con clave-con-otro-formato-123 y Bearer eyJhbGciOi.abc.def en postgresql://postgres:contrasena-db@localhost:54322/postgres'),
      { responseBody: 'token nvapi-ABCDEFGH12345678 inválido' },
    );

    const text = JSON.stringify(serializeError(error));
    for (const secret of ['clave-con-otro-formato-123', 'eyJhbGciOi', 'contrasena-db', 'nvapi-ABCDEFGH12345678']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[redacted]');
  });

  it('limita la profundidad de la cadena de causas y acepta valores que no son Error', () => {
    let error = new Error('nivel 0');
    for (let i = 1; i <= 10; i++) error = new Error(`nivel ${i}`, { cause: error });
    let depth = 0;
    for (let node = serializeError(error); node.cause; node = node.cause as Record<string, unknown>) depth++;
    expect(depth).toBeLessThanOrEqual(3);

    expect(serializeError('texto')).toEqual({ value: 'texto' });
    expect(serializeError({ message: 'con forma de error' })).toMatchObject({ message: 'con forma de error' });
  });

  it('`redact` deja intacto un texto sin secretos', () => {
    expect(redact('todo en orden')).toBe('todo en orden');
  });
});

describe('MastraJsonLogger', () => {
  it('lleva el aviso de cambio de modelo al formato JSON con el error que lo causó', () => {
    new MastraJsonLogger().warn('Model a failed; falling back to b', {
      error: Object.assign(new Error('Too Many Requests'), { statusCode: 429 }),
      modelId: 'a',
      nextModelId: 'b',
      attempt: 1,
    });

    expect(lines[0]).toMatchObject({
      level: 'warn',
      event: 'mastra.log',
      message: 'Model a failed; falling back to b',
      data: { modelId: 'a', nextModelId: 'b', attempt: 1 },
      error: { message: 'Too Many Requests', statusCode: 429 },
    });
  });

  it('solo conserva datos conocidos: el texto de la conversación que Mastra incluye en sus avisos se descarta', () => {
    new MastraJsonLogger().warn('Stream finished', {
      text: 'respuesta privada del asistente',
      messages: [{ content: 'mi pregunta privada' }],
      runId: 'run-1',
    });
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain('respuesta privada');
    expect(text).not.toContain('mi pregunta privada');
    expect(lines[0]).toMatchObject({ data: { runId: 'run-1' } });
  });

  it('los errores salen con nivel error y info/debug solo con LOG_LEVEL=debug', () => {
    const mastra = new MastraJsonLogger();
    mastra.error('Exhausted all fallback models.', new Error('Gone'));
    mastra.info('ruido informativo');
    expect(lines.map((line) => line.level)).toEqual(['error']);
    expect(lines[0]).toMatchObject({ error: { message: 'Gone' } });

    process.env.LOG_LEVEL = 'debug';
    mastra.info('ahora sí');
    expect(lines.at(-1)).toMatchObject({ level: 'info', message: 'ahora sí' });
  });
});
