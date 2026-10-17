import { randomUUID } from 'node:crypto';
import { EMBEDDING_DIMENSIONS, getDb, profiles } from '@fablab/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

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
  /** JWT real emitido por Supabase Auth. */
  token: string;
  remove: () => Promise<void>;
};

/** Crea un usuario real como lo haría un administrador (el trigger genera su perfil `staff`). */
export async function createTestUser(role: 'staff' | 'admin' = 'staff'): Promise<TestUser> {
  const email = `it-${role}-${randomUUID().slice(0, 8)}@fablab.test`;
  const password = `integration-${randomUUID()}`;

  const admin = serviceClient();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const id = created.user.id;

  if (role === 'admin') {
    await getDb().update(profiles).set({ role: 'admin' }).where(eq(profiles.id, id));
  }

  const { data: session, error: signInError } = await anonClient().auth.signInWithPassword({ email, password });
  if (signInError || !session.session) throw new Error(`No se pudo iniciar sesión: ${signInError?.message}`);

  return {
    id,
    email,
    token: session.session.access_token,
    remove: async () => {
      await admin.auth.admin.deleteUser(id);
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
