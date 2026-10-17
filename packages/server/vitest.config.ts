import { defineConfig } from 'vitest/config';

// `pnpm test` ejecuta las pruebas unitarias. Las de integración (`*.integration.test.ts`)
// usan Supabase local (Postgres, Auth y Storage reales): `pnpm test:integration`.
const integration = process.env.INTEGRATION === '1';

export default defineConfig({
  test: {
    include: integration ? ['test/**/*.integration.test.ts'] : ['test/**/*.test.ts'],
    exclude: integration ? [] : ['test/**/*.integration.test.ts'],
    setupFiles: integration ? ['test/setup-env.ts'] : [],
    testTimeout: integration ? 60_000 : 5_000,
    hookTimeout: 60_000,
    // Cada petición escribe una línea de registro: se silencian salvo en las pruebas que las comprueban.
    env: { LOG_LEVEL: 'silent' },
    // Las pruebas de integración comparten la base de datos local.
    fileParallelism: !integration,
  },
});
