import { createBrowserClient } from '@supabase/ssr';

/** Cliente de Supabase Auth para el navegador. Solo usa la URL y la clave pública. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
