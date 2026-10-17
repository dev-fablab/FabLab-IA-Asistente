import { vi } from 'vitest';

export type Recorded = { method: string; path: string; search: URLSearchParams; body?: unknown };

type Handler = (call: Recorded) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Simula `fetch` para el cliente tipado de la API (`hc`). Cada ruta se registra con
 * `"GET /api/admin/x"`; las llamadas quedan en `calls` para comprobar qué se pidió.
 */
export function mockApi() {
  const handlers = new Map<string, Handler>();
  const calls: Recorded[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const call: Recorded = {
      method,
      path: url.pathname,
      search: url.searchParams,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);

    // Se prueba primero la ruta exacta y luego con los segmentos `:id` (UUID) como comodín.
    const exact = handlers.get(`${method} ${url.pathname}`);
    const wildcard = [...handlers].find(([key]) => {
      const [m, pattern] = key.split(' ') as [string, string];
      return m === method && pattern.includes(':id') && new RegExp(`^${pattern.replace(':id', '[^/]+')}$`).test(url.pathname);
    })?.[1];
    const handler = exact ?? wildcard;
    if (!handler) throw new Error(`fetch inesperado: ${method} ${url.pathname}`);
    return handler(call);
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    on(route: string, handler: Handler) {
      handlers.set(route, handler);
    },
    calls,
    fetchMock,
    callsTo: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path),
  };
}
