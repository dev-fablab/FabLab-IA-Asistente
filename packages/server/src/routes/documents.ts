import { Hono } from 'hono';
import { z } from 'zod';
import type { EnqueueIngestion } from '../ingest/enqueue';
import { prepareIngestion } from '../ingest/index-document';
import {
  createDocument,
  deleteDocument,
  getDownload,
  listDocuments,
  startReplace,
  updateDocument,
} from '../services/documents';
import type { AppEnv } from '../types';
import { validate } from '../validation';

const idParam = z.object({ id: z.uuid() });

const uploadBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

const createBody = uploadBody.extend({
  title: z.string().trim().min(1).max(200).optional(),
});

const patchBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((body) => body.title !== undefined || body.description !== undefined, {
    message: 'Indica al menos un campo para editar',
  });

const processQuery = z.object({ force: z.enum(['true', 'false']).optional() });

export type DocumentRoutesOptions = {
  enqueueIngestion: EnqueueIngestion;
};

/** Rutas `/admin/documents`: los handlers validan, delegan en los servicios y responden. */
export function createDocumentRoutes({ enqueueIngestion }: DocumentRoutesOptions) {
  return new Hono<AppEnv>()
    .get('/', async (c) => c.json({ documents: await listDocuments() }))

    .post('/', validate('json', createBody), async (c) => {
      const result = await createDocument(c.req.valid('json'), c.get('staff').id);
      return c.json(result, 201);
    })

    .patch('/:id', validate('param', idParam), validate('json', patchBody), async (c) => {
      const document = await updateDocument(c.req.valid('param').id, c.req.valid('json'));
      return c.json({ document });
    })

    .post('/:id/process', validate('param', idParam), validate('query', processQuery), async (c) => {
      const { id } = c.req.valid('param');
      const document = await prepareIngestion(id, { force: c.req.valid('query').force === 'true' });
      enqueueIngestion(id);
      return c.json({ document }, 202);
    })

    .post('/:id/replace', validate('param', idParam), validate('json', uploadBody), async (c) => {
      return c.json(await startReplace(c.req.valid('param').id, c.req.valid('json')));
    })

    .get('/:id/download', validate('param', idParam), async (c) => {
      return c.json(await getDownload(c.req.valid('param').id));
    })

    .delete('/:id', validate('param', idParam), async (c) => {
      await deleteDocument(c.req.valid('param').id);
      return c.body(null, 204);
    });
}
