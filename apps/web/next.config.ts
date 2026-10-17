import path from 'node:path';
import type { NextConfig } from 'next';

// Raíz del monorepo: Next debe trazar y transpilar los paquetes de `packages/*`.
const monorepoRoot = path.join(import.meta.dirname, '../..');

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se publican como fuente TypeScript, sin paso de build.
  transpilePackages: ['@fablab/server', '@fablab/db', '@fablab/agent'],
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  async headers() {
    return [
      {
        source: '/voice-assets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
      {
        // La API (/api) ya aplica sus propias cabeceras desde Hono.
        source: '/((?!api).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // El chat vive en su propia página en la Fase 1; si luego se embebe en otro sitio, se revisa.
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
