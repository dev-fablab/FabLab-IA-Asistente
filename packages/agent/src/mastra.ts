import { Mastra } from '@mastra/core/mastra';
import { fabLabAgent } from './agents/fablab-agent';
import { MastraJsonLogger } from './mastra-logger';
import { enableRlsOnMastraTables, createMastraStorage } from './storage';

let instance: { mastra: Mastra; init: () => Promise<void> } | undefined;

function create() {
  const storage = createMastraStorage();
  // El logger propio lleva los avisos de Mastra (p. ej. «Model X failed; falling back to Y») al formato JSON del servidor.
  return { mastra: new Mastra({ agents: { fabLabAgent }, storage, logger: new MastraJsonLogger() }), init: () => storage.init() };
}

/**
 * Instancia de Mastra con su storage en Postgres (esquema `mastra`). Se crea al primer uso y no al
 * importar el módulo, así importar el paquete (por ejemplo en `next build`) no exige `DATABASE_URL`.
 *
 * El agente no usa `memory`: el storage guarda lo que Mastra persiste por su cuenta, no el historial
 * del chat, que vive solo en `conversations` y `messages`.
 */
export function getMastra(): Mastra {
  instance ??= create();
  return instance.mastra;
}

let ready: Promise<void> | undefined;

/**
 * Crea las tablas de Mastra (si faltan) y les activa RLS. Se memoiza por proceso; un fallo no se
 * guarda, así que la siguiente petición reintenta. En producción se puede inicializar en el despliegue
 * y evitar este costo en el primer arranque.
 */
export function ensureMastraReady(): Promise<void> {
  ready ??= (async () => {
    getMastra();
    await instance!.init();
    await enableRlsOnMastraTables();
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
