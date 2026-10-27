import type { AppType } from '@fablab/server';
import { hc } from 'hono/client';

/**
 * Cliente tipado de la API Hono (RPC). Un cambio de contrato en `packages/server`
 * rompe la compilación aquí en lugar de fallar en producción.
 *
 * La sesión viaja en la cookie de Better Auth, del mismo origen.
 */
export const api = hc<AppType>('/', {
  init: { credentials: 'include' },
});

/** Error de la API con el formato `{ error: { code, message } }`. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

/** Lanza `ApiRequestError` con el mensaje de la API si la respuesta no es exitosa. */
export async function unwrap<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (response.ok) {
    return (text ? JSON.parse(text) : undefined) as T;
  }
  let body: ApiErrorBody | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as ApiErrorBody;
    } catch {
      body = null;
    }
  }
  throw new ApiRequestError(
    body?.error?.message ?? 'No se pudo completar la solicitud',
    response.status,
    body?.error?.code ?? 'internal_error',
  );
}

/** Cliente tipado para las rutas públicas (el chat): no necesita ni envía la sesión del panel. */
export const publicApi = hc<AppType>('/');
