/** Solo http(s): el valor de un canal lo escribe el equipo, pero nunca debe poder ser `javascript:`. */
export function safeHttpUrl(value: string): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Enlace accionable de un canal de contacto: `tel:` para teléfonos, `mailto:` para correos,
 * wa.me para WhatsApp y http(s) para web y redes. Las direcciones se muestran como texto.
 */
export function contactHref(type: string, value: string): string | null {
  const text = value.trim();
  switch (type) {
    case 'phone': {
      const digits = text.replace(/[^\d+]/g, '');
      return /\d/.test(digits) ? `tel:${digits}` : null;
    }
    case 'email':
      return EMAIL.test(text) ? `mailto:${text}` : null;
    case 'whatsapp': {
      const digits = text.replace(/\D/g, '');
      return /^[\d\s()+-]+$/.test(text) && digits.length >= 8 ? `https://wa.me/${digits}` : safeHttpUrl(text);
    }
    case 'web':
    case 'social':
      return safeHttpUrl(text);
    default:
      return null;
  }
}
