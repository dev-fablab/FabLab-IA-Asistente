import type { InferResponseType } from 'hono/client';
import type { api } from '@/lib/api';

export type ProjectListItem = InferResponseType<typeof api.api.admin.projects.$get, 200>[number];
export type ProjectDetail = InferResponseType<(typeof api.api.admin.projects)[':id']['$get'], 200>;
export type ProjectTask = ProjectDetail['tasks'][number];
export type ProjectComment = ProjectDetail['comments'][number];

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export const TASK_STATUS_LABELS: Record<(typeof TASK_STATUSES)[number], string> = {
  todo: 'Todo',
  in_progress: 'En progreso',
  done: 'Hecho',
};
export const PRIORITY_LABELS = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
} as const;
