import { asc, eq } from 'drizzle-orm';
import { getDb } from './client';
import { contactChannels } from './schema';

/**
 * Canales de contacto activos, en el orden que define el equipo. Los comparten la herramienta
 * `getContactInfo` del agente y la API pública del chat, para que ambos muestren lo mismo.
 */
export async function listActiveContactChannels() {
  return getDb()
    .select({
      type: contactChannels.type,
      label: contactChannels.label,
      value: contactChannels.value,
      notes: contactChannels.notes,
    })
    .from(contactChannels)
    .where(eq(contactChannels.isActive, true))
    .orderBy(asc(contactChannels.sortOrder), asc(contactChannels.label));
}
