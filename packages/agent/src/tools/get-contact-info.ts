import { createTool } from '@mastra/core/tools';
import { listActiveContactChannels } from '@fablab/db';
import { z } from 'zod';
import { logToolFailure } from '../log';

export const GET_CONTACT_INFO_TOOL_ID = 'getContactInfo';

export const getContactInfoOutputSchema = z.object({
  channels: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      value: z.string(),
      notes: z.string().nullable(),
    }),
  ),
  /** No se pudieron leer los canales por un problema técnico: no significa que no haya ninguno cargado. */
  unavailable: z.boolean().optional(),
});

export type GetContactInfoResult = z.infer<typeof getContactInfoOutputSchema>;

/** Canales de contacto oficiales activos, tal como los administra el equipo en el panel. */
export const getContactInfo = createTool({
  id: GET_CONTACT_INFO_TOOL_ID,
  description:
    'Obtiene los canales oficiales de contacto de Fab Lab (teléfono, correo y otros). ' +
    'No inventa canales: devuelve solo los que el equipo tiene cargados.',
  inputSchema: z.object({}),
  outputSchema: getContactInfoOutputSchema,
  execute: async () => {
    try {
      return { channels: await listActiveContactChannels() };
    } catch (error) {
      logToolFailure(GET_CONTACT_INFO_TOOL_ID, error);
      return { channels: [], unavailable: true };
    }
  },
});
