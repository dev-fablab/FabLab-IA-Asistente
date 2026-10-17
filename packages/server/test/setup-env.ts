// Las pruebas de integración leen la misma configuración local que la app (apps/web/.env.local).
try {
  process.loadEnvFile('../../apps/web/.env.local');
} catch {
  // En CI las variables vienen del entorno.
}
