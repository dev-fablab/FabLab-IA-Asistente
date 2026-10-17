import { getDb } from '@fablab/db';
import { PostgresStore } from '@mastra/pg';
import { sql } from 'drizzle-orm';
import { getStorageEnv } from './env';

/**
 * Esquema aparte para las tablas de Mastra: no se mezcla con `public` (el de Drizzle, que `drizzle-kit`
 * limita con `schemaFilter`) y no debe agregarse a los esquemas expuestos de la Data API de Supabase.
 */
export const MASTRA_SCHEMA = 'mastra';

/**
 * Storage de Mastra en Postgres. Se usa para lo que Mastra persiste por su cuenta (estado de workflows,
 * trazas, evaluaciones). NO es el historial del chat: el agente no usa `memory`, así que
 * `conversations` y `messages` siguen siendo la única fuente de verdad del panel.
 *
 * `PostgresStore` admite conexiones a través de un pooler en modo transacción, así que sirve la misma
 * `DATABASE_URL` de Drizzle. El pool es propio y pequeño porque cada instancia serverless abre el suyo.
 */
export function createMastraStorage() {
  return new PostgresStore({
    id: 'fablab-mastra-storage',
    connectionString: getStorageEnv().DATABASE_URL,
    schemaName: MASTRA_SCHEMA,
    max: 3,
  });
}

/**
 * Activa RLS en todas las tablas del esquema de Mastra. Mastra las crea en tiempo de ejecución, así que
 * una migración no puede hacerlo de antemano: se aplica después de inicializar (es idempotente y cubre
 * también las tablas que agreguen versiones futuras). La API usa una conexión que omite RLS; esto deja
 * a `anon` y `authenticated` sin acceso como defensa en profundidad (tampoco tienen USAGE en el esquema).
 */
export async function enableRlsOnMastraTables(): Promise<number> {
  const db = getDb();
  const tables = await db.execute<{ tablename: string }>(
    sql.raw(`SELECT tablename FROM pg_tables WHERE schemaname = '${MASTRA_SCHEMA}' ORDER BY tablename`),
  );

  for (const { tablename } of tables) {
    // Los nombres salen de pg_tables (no de una persona); aun así se citan como identificadores.
    await db.execute(sql.raw(`ALTER TABLE "${MASTRA_SCHEMA}"."${tablename.replace(/"/g, '""')}" ENABLE ROW LEVEL SECURITY`));
  }
  return tables.length;
}
