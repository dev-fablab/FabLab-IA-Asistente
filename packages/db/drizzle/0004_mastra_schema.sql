-- Esquema del storage de Mastra (PostgresStore con schemaName = 'mastra').
-- Mastra crea sus tablas en tiempo de ejecución; aquí se deja el esquema creado y cerrado:
--   * ni `anon` ni `authenticated` tienen acceso (sin USAGE no pueden ni consultar sus tablas);
--   * no debe agregarse a los «exposed schemas» de la Data API de Supabase (por defecto solo `public`);
--   * RLS lo activa la API sobre cada tabla tras inicializar el storage (ver packages/agent/src/storage.ts).
-- drizzle-kit se limita al esquema `public` (schemaFilter) y no toca estas tablas.
CREATE SCHEMA IF NOT EXISTS "mastra";--> statement-breakpoint
REVOKE ALL ON SCHEMA "mastra" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "mastra" REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "mastra" REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "mastra" REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
