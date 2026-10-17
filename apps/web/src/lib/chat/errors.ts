export type ChatErrorKind = 'rate-limit' | 'invalid' | 'unavailable' | 'network';

export type ChatErrorInfo = {
  kind: ChatErrorKind;
  message: string;
  /** El chat ofrece los canales de contacto cuando el asistente no está disponible. */
  showContact: boolean;
};

const UNAVAILABLE = 'El asistente no está disponible en este momento. Puedes reintentar o escribirle al equipo de Fab Lab.';

/**
 * Texto del error en cualquiera de sus formas: un `Error`, un string o el objeto
 * `{ code, message }` en que Assistant UI convierte el error de la respuesta (`toChatError`).
 */
function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return '';
}

/**
 * Convierte el error del chat en un mensaje claro. El AI SDK entrega como `message` el cuerpo de
 * la respuesta HTTP (`{ error: { code, message } }`) o el texto del error del stream.
 */
export function describeChatError(error: unknown): ChatErrorInfo {
  const raw = messageOf(error);

  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return {
      kind: 'network',
      message: 'No se pudo conectar. Revisa tu conexión a internet e inténtalo de nuevo.',
      showContact: false,
    };
  }

  try {
    const { error: body } = JSON.parse(raw) as { error?: { code?: string; message?: string } };
    if (body?.code === 'rate_limited') {
      // El mensaje de la API ya dice cuánto esperar: «Podrás escribir de nuevo en 5 minutos.»
      return { kind: 'rate-limit', message: body.message ?? 'Enviaste muchos mensajes seguidos.', showContact: false };
    }
    if (body?.code === 'bad_request' || body?.code === 'payload_too_large') {
      return { kind: 'invalid', message: body.message ?? 'No se pudo enviar el mensaje.', showContact: false };
    }
  } catch {
    // No era JSON: se trata como un error del stream.
  }

  return { kind: 'unavailable', message: UNAVAILABLE, showContact: true };
}
