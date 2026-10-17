import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors';
import { logger } from '../logger';

export type RateLimitRule = {
  /** Cantidad máxima de solicitudes dentro de la ventana. */
  limit: number;
  windowMs: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Límite de tasa detrás de una interfaz: las rutas solo conocen esta forma. Hoy hay una
 * implementación en memoria; Upstash Redis o una tabla en Postgres (con la IP hasheada) serían
 * otra implementación de la misma interfaz, sin tocar rutas ni middleware.
 */
export interface RateLimiter {
  /** Registra una solicitud de `key` si todas las reglas lo permiten; si no, dice cuánto esperar. */
  consume(key: string, rules: RateLimitRule[]): Promise<RateLimitResult>;
}

const MAX_TRACKED_KEYS = 10_000;

/**
 * Ventana deslizante en memoria. Sirve para desarrollo y como control parcial en producción:
 * en serverless cada instancia tiene su propia memoria, así que el límite es por instancia
 * (best-effort). Los demás controles (largo del mensaje, tokens de salida y tope de gasto en
 * OpenRouter) acotan el costo aunque este límite se reparta entre instancias.
 */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  // Marcas de tiempo de las solicitudes aceptadas por clave. Como máximo `limit` por regla.
  const hits = new Map<string, number[]>();

  function evictIfNeeded(longestWindowMs: number, at: number) {
    if (hits.size < MAX_TRACKED_KEYS) return;
    for (const [key, stamps] of hits) {
      if (stamps.length === 0 || at - stamps[stamps.length - 1]! >= longestWindowMs) hits.delete(key);
    }
    // Si sigue lleno, se descarta lo más antiguo (Map conserva el orden de inserción).
    while (hits.size >= MAX_TRACKED_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  }

  return {
    async consume(key, rules) {
      const at = now();
      const longestWindowMs = Math.max(...rules.map((rule) => rule.windowMs));
      const stamps = (hits.get(key) ?? []).filter((stamp) => at - stamp < longestWindowMs);

      let retryAfterMs = 0;
      for (const rule of rules) {
        const inWindow = stamps.filter((stamp) => at - stamp < rule.windowMs);
        if (inWindow.length >= rule.limit) {
          // Se libera un cupo cuando sale de la ventana la solicitud más antigua que cuenta.
          const frees = inWindow[inWindow.length - rule.limit]! + rule.windowMs - at;
          retryAfterMs = Math.max(retryAfterMs, frees);
        }
      }

      if (retryAfterMs > 0) {
        hits.set(key, stamps);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }

      evictIfNeeded(longestWindowMs, at);
      stamps.push(at);
      hits.delete(key);
      hits.set(key, stamps);
      return { allowed: true };
    },
  };
}

/**
 * IP de la persona. En Vercel la plataforma fija estos encabezados y el cliente no los controla;
 * detrás de otro proxy hay que confiar solo en el que corresponda. La IP se usa únicamente como
 * clave del límite en memoria: nunca se guarda en la base de datos.
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return c.req.header('x-vercel-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || forwarded || 'unknown';
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
}

/** Límites del chat público (spec §9): 15 mensajes cada 5 minutos y 100 por día, por IP. */
export const CHAT_RATE_LIMITS: RateLimitRule[] = [
  { limit: 15, windowMs: 5 * 60 * 1000 },
  { limit: 100, windowMs: 24 * 60 * 60 * 1000 },
];

/** Responde 429 con `Retry-After` y el tiempo de espera en lenguaje claro. */
export function rateLimit(limiter: RateLimiter, rules: RateLimitRule[], scope: string) {
  return createMiddleware(async (c, next) => {
    const result = await limiter.consume(`${scope}:${clientIp(c)}`, rules);
    if (!result.allowed) {
      // Sin la IP: el registro dice qué límite saltó y cuánto falta, no quién fue.
      logger.warn('rate_limit.blocked', { scope, retryAfterSeconds: result.retryAfterSeconds });
      throw new ApiError(
        429,
        'rate_limited',
        `Enviaste muchos mensajes seguidos. Podrás escribir de nuevo en ${formatWait(result.retryAfterSeconds)}.`,
        { headers: { 'Retry-After': String(result.retryAfterSeconds) } },
      );
    }
    await next();
  });
}
