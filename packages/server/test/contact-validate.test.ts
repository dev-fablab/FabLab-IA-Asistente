import { describe, expect, it } from 'vitest';
import { normalizeChannelValue } from '../src/contact/validate';

const reject = (type: Parameters<typeof normalizeChannelValue>[0], value: string, message: RegExp) =>
  expect(() => normalizeChannelValue(type, value)).toThrow(message);

describe('normalizeChannelValue: correo', () => {
  it('acepta correos válidos', () => {
    expect(normalizeChannelValue('email', ' fablab@inacap.cl ')).toBe('fablab@inacap.cl');
    expect(normalizeChannelValue('email', 'nombre.apellido+fab@sub.dominio.cl')).toBe('nombre.apellido+fab@sub.dominio.cl');
  });

  it.each(['sin-arroba.cl', 'a@b', '@fablab.cl', 'a b@fablab.cl', 'a@fablab.cl, b@fablab.cl', '<x>@fablab.cl', 'a@fablab.c'])('rechaza %j', (value) => {
    reject('email', value, /correo/);
  });
});

describe('normalizeChannelValue: teléfono y WhatsApp', () => {
  it.each(['phone', 'whatsapp'] as const)('%s acepta el prefijo del país en distintos formatos', (type) => {
    expect(normalizeChannelValue(type, '+56 9 1234 5678')).toBe('+56 9 1234 5678');
    expect(normalizeChannelValue(type, '+56912345678')).toBe('+56912345678');
    expect(normalizeChannelValue(type, '+56 (2) 2345-6789')).toBe('+56 (2) 2345-6789');
  });

  it.each(['phone', 'whatsapp'] as const)('%s exige el prefijo y un largo razonable', (type) => {
    for (const value of ['912345678', '56 9 1234 5678', '+56', '+1234567', '+1234567890123456', '+56 9 1234 abcd', 'llamar al +56912345678']) {
      reject(type, value, /prefijo del país/);
    }
  });
});

describe('normalizeChannelValue: web y redes', () => {
  it('acepta http(s) y agrega https:// si falta el esquema', () => {
    expect(normalizeChannelValue('web', 'https://fablab.inacap.cl')).toBe('https://fablab.inacap.cl');
    expect(normalizeChannelValue('web', 'http://fablab.cl/contacto')).toBe('http://fablab.cl/contacto');
    expect(normalizeChannelValue('social', 'instagram.com/fablab')).toBe('https://instagram.com/fablab');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://fablab.cl', 'file:///etc/passwd', 'sin dominio', 'localhost', 'https://'])(
    'rechaza %j',
    (value) => {
      reject('web', value, /dirección web/);
    },
  );
});

describe('normalizeChannelValue: dirección', () => {
  it('acepta texto libre y rechaza lo vacío o demasiado corto', () => {
    expect(normalizeChannelValue('address', ' Av. Libertador 1234, Santiago ')).toBe('Av. Libertador 1234, Santiago');
    reject('address', 'ab', /demasiado corta/);
  });
});
