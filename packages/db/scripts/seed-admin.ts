/**
 * Crea (o promueve) un usuario `admin` del panel.
 *
 *   pnpm db:seed-admin -- --email persona@ejemplo.cl --password "<mínimo 12 caracteres>"
 *
 * El usuario se crea con la Admin API de Supabase Auth (el registro público está desactivado);
 * el trigger `on_auth_user_created` inserta su perfil con rol `staff` y aquí se promueve a `admin`.
 * Lee DATABASE_URL, SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de apps/web/.env.local.
 */
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/client';
import { profiles } from '../src/schema';

const { values } = parseArgs({
  // pnpm reenvía el `--` literal al script; se descarta para aceptar ambas formas de invocarlo.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    role: { type: 'string', default: 'admin' },
  },
});

const email = values.email?.trim().toLowerCase();
const role = values.role === 'staff' ? 'staff' : 'admin';
if (!email) throw new Error('Falta --email');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');

const db = getDb();
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let [profile] = await db.select().from(profiles).where(eq(profiles.email, email));

if (!profile) {
  if (!values.password) throw new Error('El usuario no existe: falta --password');
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: values.password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);
  [profile] = await db.select().from(profiles).where(eq(profiles.id, data.user.id));
  if (!profile) throw new Error('El trigger on_auth_user_created no creó el perfil');
}

await db.update(profiles).set({ role }).where(eq(profiles.id, profile.id));
console.log(`Listo: ${email} (${profile.id}) tiene rol ${role}.`);
process.exit(0);
