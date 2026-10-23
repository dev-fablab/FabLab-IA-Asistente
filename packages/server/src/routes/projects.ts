import { PROJECT_TASK_PRIORITIES, PROJECT_TASK_STATUSES } from '@fablab/db';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  addComment,
  createProject,
  createTask,
  deleteComment,
  deleteProject,
  deleteTask,
  getProjectDetail,
  listProjects,
  updateProject,
  updateTask,
} from '../services/projects';
import type { AppEnv } from '../types';
import { validate } from '../validation';

const idParam = z.object({ id: z.uuid() });
const projectFields = {
  name: z.string().trim().min(1, 'Indica el nombre').max(160),
  description: z.string().trim().max(5000).nullish(),
  personId: z.uuid(),
};
const createProjectBody = z.object(projectFields);
const patchProjectBody = z
  .object({
    name: projectFields.name.optional(),
    description: projectFields.description.optional(),
    personId: projectFields.personId.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), 'Indica al menos un campo para editar');

const taskFields = {
  title: z.string().trim().min(1, 'Indica el título').max(200),
  description: z.string().trim().max(5000).nullish(),
  status: z.enum(PROJECT_TASK_STATUSES),
  priority: z.enum(PROJECT_TASK_PRIORITIES),
  dueDate: z.iso.date().nullish(),
  assigneeId: z.uuid().nullish(),
  assigneeName: z.string().trim().max(160).nullish(),
  parentId: z.uuid().nullish(),
};
const createTaskBody = z.object({
  ...taskFields,
  status: taskFields.status.optional(),
  priority: taskFields.priority.optional(),
});
const patchTaskBody = z
  .object({
    ...taskFields,
    position: z.number().finite().min(0).max(1_000_000).optional(),
  })
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), 'Indica al menos un campo para editar');
const commentBody = z.object({ content: z.string().trim().min(1, 'Escribe un comentario').max(5000) });

export function createProjectRoutes() {
  return new Hono<AppEnv>()
    .get('/', async (c) => c.json(await listProjects()))
    .post('/', validate('json', createProjectBody), async (c) =>
      c.json(await createProject(c.req.valid('json'), c.get('staff').id), 201),
    )
    .post('/:id/tasks', validate('param', idParam), validate('json', createTaskBody), async (c) =>
      c.json({ task: await createTask(c.req.valid('param').id, c.req.valid('json'), c.get('staff').id) }, 201),
    )
    .patch('/tasks/:id', validate('param', idParam), validate('json', patchTaskBody), async (c) =>
      c.json({ task: await updateTask(c.req.valid('param').id, c.req.valid('json')) }),
    )
    .delete('/tasks/:id', validate('param', idParam), async (c) => {
      await deleteTask(c.req.valid('param').id);
      return c.body(null, 204);
    })
    .post('/tasks/:id/comments', validate('param', idParam), validate('json', commentBody), async (c) =>
      c.json({ comment: await addComment(c.req.valid('param').id, c.req.valid('json').content, c.get('staff').id) }, 201),
    )
    .delete('/comments/:id', validate('param', idParam), async (c) => {
      await deleteComment(c.req.valid('param').id);
      return c.body(null, 204);
    })
    .get('/:id', validate('param', idParam), async (c) => c.json(await getProjectDetail(c.req.valid('param').id)))
    .patch('/:id', validate('param', idParam), validate('json', patchProjectBody), async (c) =>
      c.json(await updateProject(c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', validate('param', idParam), async (c) => {
      await deleteProject(c.req.valid('param').id);
      return c.body(null, 204);
    });
}
