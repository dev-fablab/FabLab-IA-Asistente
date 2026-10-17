import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import type { RequestIdVariables } from 'hono/request-id';
import { ApiError } from '../errors';
import { logger, withLogContext } from '../logger';
import type { AppEnv } from '../types';

type RequestLogEnv = { Variables: RequestIdVariables & Partial<AppEnv['Variables']> };

/** Lo que dice el error de una respuesta 4xx/5xx; solo mensajes pensados para el cliente, sin detalles internos. */
function describeError(error: Error | undefined) {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof HTTPException) return { message: error.message };
  return undefined;
}

/**
 * Una línea por petición (`http.request`) con método, ruta, estado y duración, y el `requestId` en todo lo
 * que se registre mientras se atiende (rutas, servicios, herramientas del agente). Se monta después de
 * `requestId()`, que además devuelve el identificador en `X-Request-Id`: con él se encuentra en los
 * registros la petición que falló en el navegador.
 *
 * Solo se registran la ruta (sin cadena de consulta), el estado y, en el panel, el id de la persona del
 * equipo. Nunca cuerpos, encabezados ni la IP. `ms` llega hasta tener la respuesta: en el chat el streaming
 * continúa después y su duración total la da `chat.finished`.
 */
export function requestLog() {
  return createMiddleware<RequestLogEnv>(async (c, next) => {
    const started = performance.now();

    await withLogContext({ requestId: c.get('requestId') }, async () => {
      await next();
      // `requestId()` ya lo fija, pero se pierde si el handler devuelve un `Response` propio (el stream del chat).
      c.header('X-Request-Id', c.get('requestId'));

      const status = c.res.status;
      const staff = c.get('staff');
      const fields = {
        method: c.req.method,
        path: c.req.path,
        status,
        ms: Math.round(performance.now() - started),
        ...(staff && { staffId: staff.id }),
        ...(status >= 400 && { error: describeError(c.error) }),
      };

      if (status >= 500) logger.error('http.request', undefined, fields);
      else if (status >= 400) logger.warn('http.request', fields);
      // El sondeo de salud no debe llenar los registros.
      else if (c.req.path.endsWith('/health')) logger.debug('http.request', fields);
      else logger.info('http.request', fields);
    });
  });
}
