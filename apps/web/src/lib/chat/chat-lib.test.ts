import { beforeEach, describe, expect, it } from 'vitest';
import { CONVERSATION_STORAGE_KEY, newConversationId, readConversationId, toUiMessages, writeConversationId } from './conversation';
import { describeChatError } from './errors';
import { contactHref, safeHttpUrl } from './links';

describe('describeChatError', () => {
  const body = (code: string, message: string) => JSON.stringify({ error: { code, message } });

  // El runtime de Assistant UI entrega { code, message }, no el Error original.
  it.each([
    ['un Error', (m: string) => new Error(m)],
    ['un string', (m: string) => m],
    ['un objeto { code, message } (Assistant UI)', (m: string) => ({ code: 'unknown', message: m })],
  ])('límite de tasa desde %s: conserva el mensaje con el tiempo de espera', (_name, wrap) => {
    const message = 'Enviaste muchos mensajes seguidos. Podrás escribir de nuevo en 5 minutos.';
    expect(describeChatError(wrap(body('rate_limited', message)))).toEqual({ kind: 'rate-limit', message, showContact: false });
  });

  it('un mensaje inválido conserva el motivo del servidor', () => {
    const message = 'El mensaje es demasiado largo (máximo 2.000 caracteres)';
    expect(describeChatError({ code: 'unknown', message: body('bad_request', message) })).toEqual({ kind: 'invalid', message, showContact: false });
    expect(describeChatError(new Error(body('payload_too_large', 'La solicitud es demasiado grande'))).kind).toBe('invalid');
  });

  it('un error del stream o del servidor ofrece el contacto y no filtra detalles', () => {
    for (const error of [
      { code: 'unknown', message: 'No se pudo generar la respuesta en este momento.' },
      new Error(body('internal_error', 'Error interno')),
      'cualquier cosa',
      undefined,
      null,
    ]) {
      const info = describeChatError(error);
      expect(info.kind).toBe('unavailable');
      expect(info.showContact).toBe(true);
      expect(info.message).toContain('El asistente no está disponible');
    }
  });

  it('un fallo de red se distingue y no ofrece contacto', () => {
    for (const error of [new TypeError('Failed to fetch'), { code: 'TypeError', message: 'Failed to fetch' }, 'Load failed', 'NetworkError when attempting to fetch resource.']) {
      expect(describeChatError(error)).toMatchObject({ kind: 'network', showContact: false });
    }
  });
});

describe('conversación en el navegador', () => {
  beforeEach(() => window.localStorage.clear());

  it('guarda y lee un UUID', () => {
    const id = newConversationId();
    writeConversationId(id);
    expect(window.localStorage.getItem(CONVERSATION_STORAGE_KEY)).toBe(id);
    expect(readConversationId()).toBe(id);
  });

  it('ignora un valor guardado que no es un UUID', () => {
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, 'cualquier-cosa');
    expect(readConversationId()).toBeNull();
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, '<script>alert(1)</script>');
    expect(readConversationId()).toBeNull();
  });

  it('genera un identificador distinto cada vez', () => {
    expect(newConversationId()).not.toBe(newConversationId());
  });

  it('si localStorage falla no rompe la página', () => {
    const original = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new DOMException('bloqueado', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('bloqueado', 'SecurityError');
    };
    try {
      expect(readConversationId()).toBeNull();
      expect(() => writeConversationId(newConversationId())).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
      Storage.prototype.setItem = originalSet;
    }
  });

  it('convierte el historial en mensajes de UI solo con su texto', () => {
    expect(toUiMessages([{ id: 'a', role: 'user', content: 'Hola' }])).toEqual([{ id: 'a', role: 'user', parts: [{ type: 'text', text: 'Hola' }] }]);
  });
});

describe('safeHttpUrl', () => {
  it('acepta http(s) y completa el esquema que falte', () => {
    expect(safeHttpUrl('https://fablab.cl')).toBe('https://fablab.cl/');
    expect(safeHttpUrl('http://fablab.cl/x')).toBe('http://fablab.cl/x');
    expect(safeHttpUrl('instagram.com/fablab')).toBe('https://instagram.com/fablab');
  });

  it('rechaza esquemas peligrosos', () => {
    for (const value of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'vbscript:x']) {
      expect(safeHttpUrl(value)).toBeNull();
    }
  });
});

describe('contactHref', () => {
  it('teléfono → tel: sin espacios ni signos, conservando el +', () => {
    expect(contactHref('phone', '+56 9 1234 5678')).toBe('tel:+56912345678');
    expect(contactHref('phone', '(02) 2345-6789')).toBe('tel:0223456789');
    expect(contactHref('phone', 'sin números')).toBeNull();
  });

  it('correo → mailto: solo si tiene forma de correo', () => {
    expect(contactHref('email', 'fablab@inacap.cl')).toBe('mailto:fablab@inacap.cl');
    expect(contactHref('email', 'no es un correo')).toBeNull();
    expect(contactHref('email', 'a@b.cl?subject=x<script>')).toBeNull();
  });

  it('whatsapp → wa.me para números y enlace para URL', () => {
    expect(contactHref('whatsapp', '+56 9 1234 5678')).toBe('https://wa.me/56912345678');
    expect(contactHref('whatsapp', 'https://wa.me/56912345678')).toBe('https://wa.me/56912345678');
  });

  it('web y redes → solo http(s); dirección → texto sin enlace', () => {
    expect(contactHref('web', 'fablab.cl')).toBe('https://fablab.cl/');
    expect(contactHref('social', 'javascript:alert(1)')).toBeNull();
    expect(contactHref('address', 'Av. Siempre Viva 742')).toBeNull();
    expect(contactHref('desconocido', 'x')).toBeNull();
  });
});
