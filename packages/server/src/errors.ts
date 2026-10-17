import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'duplicate_document'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'voice_unavailable'
  | 'internal_error';

export type ErrorBody = { error: { code: ErrorCode; message: string } };

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Código de error según el estado HTTP (spec §10). */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'rate_limited';
    default:
      return 'internal_error';
  }
}

type ApiErrorOptions = {
  headers?: Record<string, string>;
  cause?: unknown;
};

/** Error esperado de la API: se responde con su mensaje, nunca con detalles internos. */
export class ApiError extends HTTPException {
  readonly code: ErrorCode;
  readonly headers: Record<string, string>;

  constructor(
    status: ContentfulStatusCode,
    code: ErrorCode,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(status, { message, cause: options.cause });
    this.code = code;
    this.headers = options.headers ?? {};
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);
export const unauthorized = (message = 'Inicia sesión para continuar') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Tu cuenta no tiene acceso a este recurso') =>
  new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Recurso no encontrado') =>
  new ApiError(404, 'not_found', message);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
