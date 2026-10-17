import type { InferResponseType } from 'hono/client';
import type { api } from '@/lib/api';

type ListResponse = InferResponseType<(typeof api.api.admin)['contact-channels']['$get'], 200>;
export type ContactChannelRow = ListResponse['channels'][number];

export const CHANNEL_TYPES = ['phone', 'email', 'whatsapp', 'web', 'social', 'address'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const TYPE_LABELS: Record<ChannelType, string> = {
  phone: 'Teléfono',
  email: 'Correo',
  whatsapp: 'WhatsApp',
  web: 'Sitio web',
  social: 'Red social',
  address: 'Dirección',
};

/** Ejemplo del formato que se espera según el tipo (la API valida y explica el motivo si no calza). */
export const VALUE_HINTS: Record<ChannelType, string> = {
  phone: '+56 9 1234 5678',
  email: 'contacto@fablab.cl',
  whatsapp: '+56 9 1234 5678',
  web: 'https://fablab.cl',
  social: 'https://instagram.com/fablab',
  address: 'Av. Ejemplo 1234, Santiago',
};

export const isChannelType = (value: string): value is ChannelType => (CHANNEL_TYPES as readonly string[]).includes(value);
