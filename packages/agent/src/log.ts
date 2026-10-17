import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Registro estructurado (una línea JSON por evento en la salida estándar) para el servidor y el agente.
 * Vive en `packages/agent` porque `packages/server` ya depende de él y no al revés: así los dos escriben
 * el mismo formato y comparten el contexto de la petición sin duplicar código.
 *
 * Nivel mínimo con `LOG_LEVEL` (`debug`, `info`, `warn`, `error` o `silent`); por defecto `info`.
 * Nunca se registran los textos de la conversación, claves ni la IP de la persona.
 */

export type LogFields = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Se lee en cada escritura para que cambiar `LOG_LEVEL` (o una prueba) surta efecto sin reiniciar. */
function minRank(): number {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (value === 'silent') return Infinity;
  // Un valor desconocido no apaga los registros: se vuelve al nivel por defecto.
  return value && Object.hasOwn(RANK, value) ? RANK[value as Level] : RANK.info;
}

/** `LOG_LEVEL=debug`: también salen los avisos informativos de las librerías (Mastra). */
export const isDebugLogging = () => process.env.LOG_LEVEL?.trim().toLowerCase() === 'debug';

/** Campos que acompañan a todo lo que se registra mientras corre una petición (p. ej. `requestId`). */
const requestContext = new AsyncLocalStorage<LogFields>();

/** Ejecuta `fn` con `fields` añadidos a cada registro que se escriba dentro, incluso tras un `await`. */
export function withLogContext<T>(fields: LogFields, fn: () => T): T {
  return requestContext.run({ ...requestContext.getStore(), ...fields }, fn);
}

// Variables cuyo valor jamás debe aparecer en un registro, aunque un mensaje de error lo incluya.
const SECRET_ENV = ['OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET', 'DATABASE_URL'] as const;

/** Oculta claves y tokens en un texto que viene de fuera (mensajes de error, respuestas de proveedores). */
export function redact(text: string): string {
  let result = text;
  for (const name of SECRET_ENV) {
    const secret = process.env[name];
    if (secret && secret.length >= 8) result = result.replaceAll(secret, '[redacted]');
  }
  return result
    .replace(/\b(nvapi-|sk-)[\w-]{8,}/g, '$1[redacted]')
    .replace(/(Bearer\s+)[\w.~+/=-]+/gi, '$1[redacted]');
}

const MAX_BODY_CHARS = 1000;
const MAX_CAUSE_DEPTH = 3;

type ErrorLike = { message: string; name?: unknown; stack?: unknown };

const isErrorLike = (value: unknown): value is ErrorLike =>
  value instanceof Error ||
  (typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string');

/** Dirección del proveedor sin la cadena de consulta, que podría llevar credenciales. */
function stripQuery(url: string): string {
  try {
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  } catch {
    return redact(url.split('?')[0] ?? '');
  }
}

/**
 * Error en forma de datos. Además de nombre, mensaje y traza conserva lo que explica un fallo de proveedor
 * (`statusCode`, `responseBody`, `url`, `code`) y la cadena de `cause`, que es donde el SDK de IA deja el
 * error real. No copia los cuerpos de la solicitud ni las cabeceras: llevan la conversación y la clave.
 */
export function serializeError(error: unknown, depth = 0): LogFields {
  if (!isErrorLike(error)) {
    return { value: redact(typeof error === 'string' ? error : String(error)).slice(0, MAX_BODY_CHARS) };
  }

  const extra = error as ErrorLike & Record<string, unknown>;
  const cause = extra.cause ?? extra.lastError;
  return {
    name: typeof extra.name === 'string' ? extra.name : 'Error',
    message: redact(extra.message),
    ...(typeof extra.stack === 'string' && { stack: redact(extra.stack) }),
    ...((typeof extra.code === 'string' || typeof extra.code === 'number') && { code: extra.code }),
    ...(typeof extra.statusCode === 'number' && { statusCode: extra.statusCode }),
    ...(typeof extra.isRetryable === 'boolean' && { isRetryable: extra.isRetryable }),
    ...(typeof extra.url === 'string' && { url: stripQuery(extra.url) }),
    ...(typeof extra.responseBody === 'string' && { responseBody: redact(extra.responseBody).slice(0, MAX_BODY_CHARS) }),
    ...(cause !== undefined && depth < MAX_CAUSE_DEPTH && { cause: serializeError(cause, depth + 1) }),
  };
}

function write(level: Level, event: string, bound: LogFields, fields: LogFields | undefined) {
  if (RANK[level] < minRank()) return;

  const entry = { level, event, time: new Date().toISOString(), ...requestContext.getStore(), ...bound, ...fields };
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    // Un campo que no se puede serializar (referencia circular, BigInt) no debe tumbar la petición.
    line = JSON.stringify({ level, event, time: entry.time, logError: 'campos no serializables' });
  }

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, error?: unknown, fields?: LogFields): void;
  /**
   * Logger que añade `fields` a todo lo que escribe. También conserva el contexto de la petición vigente
   * al crearlo, así sigue identificando la petición aunque lo usen callbacks que corren después de responder.
   */
  child(fields: LogFields): Logger;
};

function createLogger(bound: LogFields = {}): Logger {
  return {
    debug: (event, fields) => write('debug', event, bound, fields),
    info: (event, fields) => write('info', event, bound, fields),
    warn: (event, fields) => write('warn', event, bound, fields),
    error: (event, error, fields) =>
      write('error', event, bound, { ...fields, ...(error === undefined ? {} : { error: serializeError(error) }) }),
    child: (fields) => createLogger({ ...requestContext.getStore(), ...bound, ...fields }),
  };
}

export const logger = createLogger();

/** Una herramienta del agente falló; el turno sigue con una señal `unavailable` (ver cada herramienta). */
export function logToolFailure(tool: string, error: unknown): void {
  logger.error('tool.failed', error, { tool });
}
