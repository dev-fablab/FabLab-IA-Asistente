import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

// En desarrollo Next recarga los módulos: se guarda el cliente en globalThis
// para no abrir un pool nuevo en cada recarga.
const globalForDb = globalThis as typeof globalThis & { __fablabDb?: Database };

/**
 * Cliente de Drizzle sobre una conexión directa de Postgres. Esta conexión omite RLS:
 * la autorización vive en la API (`requireStaff`), nunca en el navegador.
 *
 * Se crea de forma perezosa para que importar el paquete (por ejemplo durante
 * `next build`) no exija `DATABASE_URL`.
 */
export function getDb(): Database {
  if (globalForDb.__fablabDb) return globalForDb.__fablabDb;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida');

  // `prepare: false` es obligatorio con el pooler de Supabase en modo transacción.
  const client = postgres(url, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
  globalForDb.__fablabDb = drizzle(client, { schema });
  return globalForDb.__fablabDb;
}
