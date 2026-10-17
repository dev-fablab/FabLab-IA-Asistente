import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ApiError, codeForStatus, errorBody } from '../errors';
import { logger } from '../logger';

/** Manejador central: toda respuesta de error usa `{ error: { code, message } }`. */
export function handleError(error: Error, c: Context) {
  if (error instanceof ApiError) {
    return c.json(errorBody(error.code, error.message), error.status, error.headers);
  }

  if (error instanceof HTTPException) {
    const status = error.status;
    // Los errores de Hono (cuerpo mal formado, etc.) son del cliente; el mensaje es seguro.
    return c.json(
      errorBody(codeForStatus(status), status >= 500 ? 'Error interno' : error.message || 'Solicitud no válida'),
      status as 400,
    );
  }

  // Error inesperado: el detalle va al registro, no a la respuesta.
  logger.error('request.unhandled', error, { method: c.req.method, path: c.req.path });
  return c.json(errorBody('internal_error', 'Error interno'), 500);
}

export function handleNotFound(c: Context) {
  return c.json(errorBody('not_found', 'Recurso no encontrado'), 404);
}
