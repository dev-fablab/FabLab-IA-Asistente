import { Hono } from 'hono';
import { createEnqueueIngestion } from '../ingest/enqueue';
import type { AppEnv, ScheduleBackground } from '../types';
import { createContactChannelRoutes } from './contact-channels';
import { createConversationRoutes } from './conversations';
import { createDocumentRoutes } from './documents';

export type AdminRoutesOptions = {
  scheduleBackground: ScheduleBackground;
};

/**
 * Rutas de administración, montadas en `/admin`. `requireStaff` ya se aplicó en `createApp`,
 * así que aquí `c.get('staff')` siempre existe.
 */
export function createAdminRoutes({ scheduleBackground }: AdminRoutesOptions) {
  const enqueueIngestion = createEnqueueIngestion(scheduleBackground);

  return new Hono<AppEnv>()
    .get('/me', (c) => c.json(c.get('staff')))
    .route('/documents', createDocumentRoutes({ enqueueIngestion }))
    .route('/conversations', createConversationRoutes())
    .route('/contact-channels', createContactChannelRoutes());
}
