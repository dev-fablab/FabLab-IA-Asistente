import { contactChannels, getDb, type ContactChannel, type ContactChannelType } from '@fablab/db';
import { asc, eq } from 'drizzle-orm';
import { normalizeChannelValue } from '../contact/validate';
import { notFound } from '../errors';

export type ChannelInput = {
  type: ContactChannelType;
  label: string;
  value: string;
  notes?: string | null | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
};

export async function listContactChannels(): Promise<ContactChannel[]> {
  return getDb().select().from(contactChannels).orderBy(asc(contactChannels.sortOrder), asc(contactChannels.label));
}

export async function createContactChannel(input: ChannelInput): Promise<ContactChannel> {
  const [channel] = await getDb()
    .insert(contactChannels)
    .values({
      type: input.type,
      label: input.label,
      value: normalizeChannelValue(input.type, input.value),
      notes: input.notes ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    })
    .returning();
  return channel!;
}

/**
 * El valor se valida contra el tipo, y cualquiera de los dos puede cambiar por separado, así que
 * se valida el registro resultante y no solo los campos enviados.
 */
export async function updateContactChannel(id: string, patch: Partial<ChannelInput>): Promise<ContactChannel> {
  const db = getDb();
  const [current] = await db.select().from(contactChannels).where(eq(contactChannels.id, id));
  if (!current) throw notFound('Canal de contacto no encontrado');

  const type = patch.type ?? (current.type as ContactChannelType);
  const value = normalizeChannelValue(type, patch.value ?? current.value);

  const [channel] = await db
    .update(contactChannels)
    .set({
      type,
      value,
      ...(patch.label !== undefined && { label: patch.label }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
    })
    .where(eq(contactChannels.id, id))
    .returning();
  return channel!;
}

export async function deleteContactChannel(id: string): Promise<void> {
  const deleted = await getDb().delete(contactChannels).where(eq(contactChannels.id, id)).returning({ id: contactChannels.id });
  if (deleted.length === 0) throw notFound('Canal de contacto no encontrado');
}
