import { defineConfig } from 'drizzle-kit';

// Las variables viven en apps/web/.env.local (las lee también Next.js). Los scripts
// de este paquete se ejecutan con packages/db como directorio de trabajo.
try {
  process.loadEnvFile('../../apps/web/.env.local');
} catch {
  // Sin archivo se usan las variables del entorno (CI, producción).
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  // Solo el esquema `public`: así drizzle-kit no toca `auth`, `storage` ni tablas de otras herramientas.
  schemaFilter: ['public'],
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
