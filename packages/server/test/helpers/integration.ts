import { randomUUID } from 'node:crypto';
import { EMBEDDING_DIMENSIONS, getDb, users } from '@fablab/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { getAuth } from '../../src/auth/instance';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}: levanta Supabase local y revisa apps/web/.env.local`);
  return value;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Cliente con la clave de servicio: solo para preparar y verificar datos en las pruebas. */
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), noSession);
}

/** Cliente con la clave pública, como el navegador: no debe poder leer nada. */
export function anonClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), noSession);
}

export type TestUser = {
  id: string;
  email: string;
  /** Cookie de sesión de Better Auth (`nombre=valor`). */
  cookie: string;
  remove: () => Promise<void>;
};

function sessionCookie(response: Response): string {
  const parts = response.headers.getSetCookie().map((value) => value.split(';')[0]?.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error('El inicio de sesión no entregó cookie');
  return parts.join('; ');
}

/** Crea un usuario real como lo haría un administrador y abre su sesión. */
export async function createTestUser(role: 'staff' | 'admin' = 'staff'): Promise<TestUser> {
  const email = `it-${role}-${randomUUID().slice(0, 8)}@inacapmail.cl`;
  const password = `integration-${randomUUID()}`;
  const auth = getAuth();

  const created = await auth.api.createUser({
    body: { email, password, name: email.split('@')[0] ?? 'staff', role },
  });
  const id = created.user.id;

  const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!signIn.ok) throw new Error(`No se pudo iniciar sesión de prueba (${signIn.status})`);

  return {
    id,
    email,
    cookie: sessionCookie(signIn),
    remove: async () => {
      await getDb().delete(users).where(eq(users.id, id));
    },
  };
}

/** Vector determinista de la dimensión de la columna, derivado del texto (sin llamar a un modelo). */
export function fakeEmbedding(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (let i = 0; i < text.length; i++) {
    vector[(text.charCodeAt(i) * 31 + i) % dimensions]! += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}
