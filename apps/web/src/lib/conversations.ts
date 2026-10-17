import type { InferResponseType } from 'hono/client';
import type { api } from '@/lib/api';

type ListResponse = InferResponseType<typeof api.api.admin.conversations.$get, 200>;
export type ConversationRow = ListResponse['items'][number];

type DetailResponse = InferResponseType<(typeof api.api.admin.conversations)[':id']['$get'], 200>;
export type ConversationDetail = DetailResponse;
export type ConversationMessage = DetailResponse['messages'][number];

/** Filtros de la lista, tal como viajan en la URL del panel. */
export type ConversationQuery = {
  page: number;
  noAnswer: boolean;
  from: string;
  to: string;
  q: string;
};

export function queryFromSearchParams(params: URLSearchParams): ConversationQuery {
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    noAnswer: params.get('noAnswer') === 'true',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    q: params.get('q') ?? '',
  };
}

/** Solo viajan los filtros con valor, para que la URL quede corta y legible. */
export function searchParamsFromQuery(query: ConversationQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page > 1) params.set('page', String(query.page));
  if (query.noAnswer) params.set('noAnswer', 'true');
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.q.trim()) params.set('q', query.q.trim());
  return params;
}

/** Parámetros de la API: los filtros vacíos se omiten. */
export function apiQueryFromQuery(query: ConversationQuery) {
  return {
    page: String(query.page),
    ...(query.noAnswer && { noAnswer: 'true' as const }),
    ...(query.from && { from: query.from }),
    ...(query.to && { to: query.to }),
    ...(query.q.trim() && { q: query.q.trim() }),
  };
}

export const hasActiveFilters = (query: ConversationQuery) =>
  query.noAnswer || Boolean(query.from) || Boolean(query.to) || Boolean(query.q.trim());

const dateTime = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
const timeOnly = new Intl.DateTimeFormat('es-CL', { timeStyle: 'medium' });
export const formatDateTime = (value: string | Date) => dateTime.format(new Date(value));
export const formatTime = (value: string | Date) => timeOnly.format(new Date(value));
