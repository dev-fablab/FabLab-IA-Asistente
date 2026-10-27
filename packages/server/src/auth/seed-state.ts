/**
 * Arranque perezoso de las cuentas predeterminadas.
 * Vive aparte de la instancia para que el hook de inicio de sesión no importe
 * el módulo que todavía se está construyendo.
 */
let pending: Promise<void> | undefined;
let starter: (() => Promise<void>) | undefined;

export function registerSeed(start: () => Promise<void>): void {
  starter = start;
}

/** Espera el alta de las cuentas de producción o staging. Fuera de esos entornos resuelve al instante. */
export function whenSeeded(): Promise<void> {
  if (!starter) return Promise.resolve();
  pending ??= starter().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
