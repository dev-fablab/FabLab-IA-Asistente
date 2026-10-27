import { getDb, profiles, type ProfileRole } from '@fablab/db';

/** El plugin guarda el rol en `users`; el panel lo lee desde `profiles`. */
export function toProfileRole(role: unknown): ProfileRole {
  const value = typeof role === 'string' ? role : '';
  return value.split(',').some((part) => part.trim() === 'admin') ? 'admin' : 'staff';
}

export async function upsertProfile(user: {
  id: string;
  email: string;
  role?: unknown;
}): Promise<void> {
  const role = toProfileRole(user.role);
  // El nombre de Better Auth es solo la parte local del correo. El panel sigue
  // mostrando el correo mientras `full_name` esté vacío.
  await getDb()
    .insert(profiles)
    .values({
      id: user.id,
      email: user.email,
      role,
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { email: user.email, role },
    });
}
