import { createApp } from '@fablab/server';
import { handle } from 'hono/vercel';
import { after } from 'next/server';

export const runtime = 'nodejs';
// Tope de la función en Vercel; la ingesta de documentos corre dentro de este límite.
export const maxDuration = 300;

// Toda la lógica vive en packages/*: este archivo solo monta la app en Next.js.
// `after` mantiene viva la función mientras corre la ingesta, ya con la respuesta enviada.
const app = createApp({
  basePath: '/api',
  scheduleBackground: (task) => after(task),
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
