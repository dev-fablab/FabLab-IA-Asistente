/**
 * Solo para la CLI de Better Auth (`auth generate`).
 * La aplicación no importa este archivo: usa `getAuth()`, que arranca en la primera petición.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '@fablab/db';
import { createAuth } from './create-auth';

function loadLocalEnv(): void {
  for (const path of [resolve(process.cwd(), 'apps/web/.env.local'), resolve(process.cwd(), '../../apps/web/.env.local')]) {
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    return;
  }
}

loadLocalEnv();

export const auth = createAuth(getDb());
