import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { createDefaultAuthDeps } from './auth/deps';
import { getAuth } from './auth/instance';
import { whenSeeded } from './auth/seed-state';
import { logger } from './logger';
import { handleError, handleNotFound } from './middleware/error';
import { createMemoryRateLimiter, type RateLimiter } from './middleware/rate-limit';
import { requestLog } from './middleware/request-log';
import { requireStaff } from './middleware/require-staff';
import { createAdminRoutes } from './routes/admin';
import { createChatRoutes } from './routes/chat';
import { createVoiceRoutes } from './routes/voice';
import type { AuthDeps, ScheduleBackground } from './types';

export type CreateAppOptions<BasePath extends string = string> = {
  /** Prefijo de todas las rutas; la web monta la API en `/api`. */
  basePath?: BasePath;
  /** Ejecuta trabajo tras responder. Por defecto lo lanza sin esperar (no apto para serverless). */
  scheduleBackground?: ScheduleBackground;
  /** Dependencias de autenticación; por defecto leen la sesión de Better Auth. */
  auth?: AuthDeps;
  /** Límite de tasa del chat público; por defecto en memoria (ver `createMemoryRateLimiter`). */
  rateLimiter?: RateLimiter;
};

// Compartido entre peticiones de la misma instancia para que el límite persista.
const defaultRateLimiter = createMemoryRateLimiter();

const runDetached: ScheduleBackground = (task) => {
  task().catch((error) => logger.error('background.failed', error));
};

/**
 * Construye la app Hono. No depende de Next.js: `apps/web` la monta con `hono/vercel`
 * y un servicio Node propio podría servirla con `@hono/node-server`.
 */
export function createApp<const BasePath extends string = '/api'>(options: CreateAppOptions<BasePath> = {}) {
  // El prefijo es un tipo literal para que el cliente tipado (`hc`) conserve las rutas completas.
  const {
    basePath = '/api' as BasePath,
    scheduleBackground = runDetached,
    auth = createDefaultAuthDeps(),
    rateLimiter = defaultRateLimiter,
  } = options;

  const app = new Hono()
    .basePath(basePath)
    // Sin middleware de CORS: la web y la API comparten origen, así que queda cerrado.
    .use(secureHeaders())
    // Identificador por petición (también en la respuesta, `X-Request-Id`) y una línea de registro por petición.
    .use(requestId())
    .use(requestLog())
    .get('/health', (c) => c.json({ ok: true }))
    // Better Auth vive bajo el mismo origen. La app Hono ya tiene prefijo `/api`.
    .all('/auth/*', async (c) => {
      await whenSeeded();
      return getAuth().handler(c.req.raw);
    })
    // Público, con límite de tasa: el chat anónimo.
    .route('/chat', createChatRoutes({ limiter: rateLimiter }))
    .route('/voice', createVoiceRoutes(rateLimiter))
    // Toda ruta bajo /admin exige sesión y perfil, sin excepciones.
    .use('/admin/*', requireStaff(auth))
    .route('/admin', createAdminRoutes({ scheduleBackground }));

  app.onError(handleError);
  app.notFound(handleNotFound);
  return app;
}

/** La web lo importa para el cliente tipado (`hc`). */
export type AppType = ReturnType<typeof createApp<'/api'>>;
