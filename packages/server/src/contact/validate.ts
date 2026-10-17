import type { ContactChannelType } from '@fablab/db';
import { badRequest } from '../errors';

const EMAIL = /^[^\s@<>"'`;,]+@[^\s@<>"'`;,]+\.[^\s@<>"'`;,]{2,}$/;
const PHONE_CHARS = /^\+[\d\s().-]+$/;

/**
 * Valida y normaliza el valor de un canal según su tipo (spec §8): correo con formato de correo,
 * teléfono con prefijo de país y direcciones web con http(s). Devuelve el valor listo para guardar.
 */
export function normalizeChannelValue(type: ContactChannelType, value: string): string {
  const text = value.trim();

  switch (type) {
    case 'email':
      if (!EMAIL.test(text)) throw badRequest('El correo no tiene un formato válido, por ejemplo contacto@fablab.cl');
      return text;

    case 'phone':
    case 'whatsapp': {
      const digits = text.replace(/\D/g, '');
      // E.164: hasta 15 dígitos; 8 es el mínimo razonable con el prefijo del país.
      if (!PHONE_CHARS.test(text) || digits.length < 8 || digits.length > 15) {
        throw badRequest('El teléfono debe incluir el prefijo del país, por ejemplo +56 9 1234 5678');
      }
      return text;
    }

    case 'web':
    case 'social': {
      // Se acepta sin esquema (instagram.com/fablab); se guarda con https://.
      const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
      let url: URL;
      try {
        url = new URL(candidate);
      } catch {
        throw badRequest('La dirección web no es válida, por ejemplo https://fablab.cl');
      }
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) {
        throw badRequest('La dirección web debe comenzar con http:// o https:// y tener un dominio válido');
      }
      return candidate;
    }

    case 'address':
      if (text.length < 3) throw badRequest('La dirección es demasiado corta');
      return text;
  }
}
