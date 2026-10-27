// Las pruebas de integración leen la misma configuración local que la app (apps/web/.env.local).
try {
  process.loadEnvFile('../../apps/web/.env.local');
} catch {
  // En CI las variables vienen del entorno.
}

process.env.BETTER_AUTH_SECRET ??= 'integration-test-secret-with-32-characters';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
