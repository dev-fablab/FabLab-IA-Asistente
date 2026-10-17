import type { ScheduleBackground } from '../types';
import { runIngestion } from './index-document';

/** Encola la ingesta de un documento. Las rutas solo conocen esta interfaz. */
export type EnqueueIngestion = (documentId: string) => void;

/**
 * Fase 1: la ingesta corre en segundo plano dentro de la misma función (`after` en Next.js),
 * con el estado persistido en `documents` y reintento manual. Si el volumen o la duración lo
 * exigen, se reemplaza esta función por un worker (por ejemplo pg-boss) sin cambiar rutas ni esquema.
 */
export function createEnqueueIngestion(schedule: ScheduleBackground): EnqueueIngestion {
  return (documentId) => schedule(() => runIngestion(documentId));
}
