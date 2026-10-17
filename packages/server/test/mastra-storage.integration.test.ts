import { enableRlsOnMastraTables, ensureMastraReady, getMastra, MASTRA_SCHEMA } from '@fablab/agent';
import { getDb } from '@fablab/db';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

const names = async (query: ReturnType<typeof sql>) =>
  ((await getDb().execute(query)) as unknown as { name: string }[]).map((row) => row.name);

const mastraTables = () =>
  names(sql`select tablename as name from pg_tables where schemaname = ${MASTRA_SCHEMA} order by tablename`);

beforeAll(async () => {
  await ensureMastraReady();
});

describe('storage de Mastra en Postgres', () => {
  it('crea las tablas de Mastra en su propio esquema', async () => {
    const tables = await mastraTables();

    expect(MASTRA_SCHEMA).toBe('mastra');
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toEqual(expect.arrayContaining(['mastra_threads', 'mastra_messages']));
    expect(tables.every((table) => table.startsWith('mastra_'))).toBe(true);
  });

  it('no deja ninguna tabla de Mastra en `public`, que es solo de Drizzle', async () => {
    const inPublic = await names(
      sql`select tablename as name from pg_tables where schemaname = 'public' and tablename like 'mastra\\_%'`,
    );
    expect(inPublic).toEqual([]);

    // Y Drizzle conserva sus tablas.
    const drizzleTables = await names(sql`select tablename as name from pg_tables where schemaname = 'public'`);
    expect(drizzleTables).toEqual(expect.arrayContaining(['documents', 'document_chunks', 'conversations', 'messages', 'profiles', 'contact_channels']));
  });

  it('activa RLS en todas las tablas del esquema', async () => {
    const withoutRls = await names(sql`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${MASTRA_SCHEMA} and c.relkind = 'r' and not c.relrowsecurity
    `);
    expect(withoutRls).toEqual([]);
  });

  it('RLS también cubre tablas que aparezcan después (se reaplica al inicializar)', async () => {
    await getDb().execute(sql.raw(`create table "${MASTRA_SCHEMA}"."mastra_tabla_futura_de_prueba" (id int)`));
    try {
      expect(await names(sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${MASTRA_SCHEMA} and c.relname = 'mastra_tabla_futura_de_prueba' and not c.relrowsecurity`)).toEqual([
        'mastra_tabla_futura_de_prueba',
      ]);

      // Una instancia nueva (otro arranque) vuelve a inicializar y endurece lo que falte.
      await enableRlsOnMastraTables();

      expect(await names(sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${MASTRA_SCHEMA} and c.relname = 'mastra_tabla_futura_de_prueba' and not c.relrowsecurity`)).toEqual([]);
    } finally {
      await getDb().execute(sql.raw(`drop table if exists "${MASTRA_SCHEMA}"."mastra_tabla_futura_de_prueba"`));
    }
  });

  it('es idempotente y las llamadas simultáneas comparten la misma inicialización', async () => {
    const before = await mastraTables();
    const calls = [ensureMastraReady(), ensureMastraReady(), ensureMastraReady()];
    expect(calls[0]).toBe(calls[1]);
    await Promise.all(calls);
    expect(await mastraTables()).toEqual(before);
  });

  it('la instancia de Mastra tiene storage configurado y el agente registrado', () => {
    const mastra = getMastra();
    expect(mastra.getStorage()).toBeDefined();
    expect(mastra.getAgentById('fabLabAgent')).toBeDefined();
    expect(getMastra()).toBe(mastra); // una sola instancia por proceso
  });
});

describe('acceso de los roles de la Data API', () => {
  // `postgres` puede asumir estos roles: así se prueba lo que verían `anon` y `authenticated`.
  const asRole = (role: 'anon' | 'authenticated') =>
    getDb().transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role ${role}`));
      await tx.execute(sql.raw(`select * from "${MASTRA_SCHEMA}"."mastra_threads" limit 1`));
    });

  it.each(['anon', 'authenticated'] as const)('%s no puede leer las tablas de Mastra', async (role) => {
    await expect(asRole(role)).rejects.toThrow(/permission denied|failed query/i);
  });

  it('anon y authenticated no tienen siquiera USAGE sobre el esquema', async () => {
    const [row] = (await getDb().execute(
      sql`select has_schema_privilege('anon', ${MASTRA_SCHEMA}, 'USAGE') as anon, has_schema_privilege('authenticated', ${MASTRA_SCHEMA}, 'USAGE') as auth`,
    )) as unknown as { anon: boolean; auth: boolean }[];
    expect(row).toEqual({ anon: false, auth: false });
  });
});
