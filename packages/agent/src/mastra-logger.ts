import { LogLevel, MastraLogger } from '@mastra/core/logger';
import { isDebugLogging, logger, redact, serializeError, type LogFields } from './log';

type Level = 'debug' | 'info' | 'warn' | 'error';

const isPrimitive = (value: unknown): value is string | number | boolean | null =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/**
 * Datos de Mastra que se conservan. Es una lista blanca porque sus avisos de depuración llevan el texto de la
 * conversación en campos como `text` (p. ej. «Stream finished»); lo desconocido se descarta.
 */
const SAFE_DATA_KEYS = new Set([
  'agent', 'agentId', 'agentName', 'tool', 'name', 'runId', 'modelId', 'nextModelId', 'attempt', 'totalModels', 'finishReason',
]);

/**
 * Mastra registra con `logger.warn(mensaje, { error, modelId, ... })`. Del objeto de datos solo se conservan
 * los errores y los valores simples de las claves conocidas.
 */
function forward(level: Level, message: string, args: unknown[]) {
  const data: LogFields = {};
  let error: unknown;

  for (const arg of args) {
    if (arg instanceof Error) {
      error ??= arg;
    } else if (typeof arg === 'object' && arg !== null) {
      for (const [key, value] of Object.entries(arg)) {
        if (value instanceof Error) error ??= value;
        else if (SAFE_DATA_KEYS.has(key) && isPrimitive(value)) data[key] = typeof value === 'string' ? redact(value) : value;
      }
    }
  }

  const fields: LogFields = { message: redact(message), ...(Object.keys(data).length > 0 && { data }) };
  if (level === 'error') logger.error('mastra.log', error, fields);
  else logger[level]('mastra.log', { ...fields, ...(error !== undefined && { error: serializeError(error) }) });
}

/**
 * Lleva los registros internos de Mastra (reintentos, cambio al modelo de respaldo con el error que lo
 * causó) al mismo formato JSON y a la misma petición que el resto. Por defecto solo `warn` y `error`,
 * como el logger de Mastra en producción; con `LOG_LEVEL=debug` salen también `info` y `debug`.
 */
export class MastraJsonLogger extends MastraLogger {
  constructor() {
    super({ name: 'Mastra', level: LogLevel.WARN });
  }

  override debug(message: string, ...args: unknown[]) {
    if (isDebugLogging()) forward('debug', message, args);
  }

  override info(message: string, ...args: unknown[]) {
    if (isDebugLogging()) forward('info', message, args);
  }

  override warn(message: string, ...args: unknown[]) {
    forward('warn', message, args);
  }

  override error(message: string, ...args: unknown[]) {
    forward('error', message, args);
  }
}
