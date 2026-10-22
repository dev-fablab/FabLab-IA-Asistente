import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/dist/**',
    '**/coverage/**',
    'apps/web/public/voice-assets/**',
    'packages/db/drizzle/**',
    'apps/web/next-env.d.ts',
    // Código generado por shadcn/ui, el registro @reui y Assistant UI: se actualiza con sus CLI, no a mano.
    'apps/web/src/components/ui/**',
    'apps/web/src/components/reui/**',
    'apps/web/src/components/assistant-ui/**',
    'apps/web/src/hooks/use-mobile.ts',
  ]),

  // Paquetes del servidor y herramientas: TypeScript sin React.
  {
    files: ['packages/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },

  // Aplicación web: reglas de Next.js (Core Web Vitals) y TypeScript.
  {
    files: ['apps/web/**/*.{ts,tsx,mjs}'],
    extends: [...nextVitals, ...nextTs],
    settings: { next: { rootDir: 'apps/web/' } },
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
]);
