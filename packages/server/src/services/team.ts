import { getDb, profiles } from '@fablab/db';
import { asc, sql } from 'drizzle-orm';

/**
 * El equipo del panel (staff y admin). Cualquiera de ellos puede ser responsable de una reunión, así que la
 * lista incluye a todos los perfiles, sin filtrar por rol.
 */
export async function listTeam() {
  return getDb()
    .select({ id: profiles.id, email: profiles.email, fullName: profiles.fullName, role: profiles.role })
    .from(profiles)
    .orderBy(asc(sql`lower(coalesce(${profiles.fullName}, ${profiles.email}))`));
}
