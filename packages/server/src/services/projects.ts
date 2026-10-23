import {
  comments,
  contacts,
  getDb,
  profiles,
  projectMembers,
  projects,
  tasks,
  type ProjectTaskPriority,
  type ProjectTaskStatus,
} from '@fablab/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { badRequest, conflict, notFound } from '../errors';

type ProjectFields = { name: string; description?: string | null; personId: string };
type TaskFields = {
  title: string;
  description?: string | null;
  status?: ProjectTaskStatus;
  priority?: ProjectTaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  parentId?: string | null;
};

const projectSummary = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  personId: projects.personId,
  personName: contacts.name,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

async function requireProject(id: string) {
  const [project] = await getDb().select(projectSummary).from(projects).innerJoin(contacts, eq(projects.personId, contacts.id)).where(eq(projects.id, id));
  if (!project) throw notFound('Proyecto no encontrado');
  return project;
}

async function requireTask(id: string) {
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, id));
  if (!task) throw notFound('Tarea no encontrada');
  return task;
}

export async function listProjects() {
  const db = getDb();
  const rows = await db
    .select({
      ...projectSummary,
      taskCount: sql<number>`count(${tasks.id})::int`,
      doneCount: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')::int`,
    })
    .from(projects)
    .innerJoin(contacts, eq(projects.personId, contacts.id))
    .leftJoin(tasks, and(eq(tasks.projectId, projects.id), sql`${tasks.parentId} is null`))
    .groupBy(projects.id, contacts.id)
    .orderBy(desc(projects.updatedAt), asc(projects.name));
  return rows;
}

export async function getProjectDetail(id: string) {
  const project = await requireProject(id);
  const db = getDb();
  const taskRows = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      parentId: tasks.parentId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      position: tasks.position,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      assigneeName: sql<string | null>`coalesce(nullif(${profiles.fullName}, ''), nullif(${contacts.name}, ''), nullif(${tasks.assigneeName}, ''), ${profiles.email})`,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
    .leftJoin(contacts, sql`lower(${contacts.email}) = lower(${profiles.email})`)
    .where(eq(tasks.projectId, id))
    .orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.createdAt));

  const taskIds = taskRows.map((task) => task.id);
  const commentRows = taskIds.length
    ? await db
        .select({
          id: comments.id,
          taskId: comments.taskId,
          content: comments.content,
          authorId: comments.authorId,
          authorName: sql<string>`coalesce(${profiles.fullName}, ${profiles.email})`,
          createdAt: comments.createdAt,
          updatedAt: comments.updatedAt,
        })
        .from(comments)
        .innerJoin(profiles, eq(comments.authorId, profiles.id))
        .where(inArray(comments.taskId, taskIds))
        .orderBy(asc(comments.createdAt))
    : [];

  const members = await db
    .select({
      profileId: projectMembers.profileId,
      role: projectMembers.role,
      name: sql<string>`coalesce(${profiles.fullName}, ${profiles.email})`,
      email: profiles.email,
    })
    .from(projectMembers)
    .innerJoin(profiles, eq(projectMembers.profileId, profiles.id))
    .where(eq(projectMembers.projectId, id))
    .orderBy(asc(profiles.fullName), asc(profiles.email));

  return { project, tasks: taskRows, comments: commentRows, members };
}

export async function createProject(fields: ProjectFields, staffId: string) {
  const [person] = await getDb().select({ id: contacts.id }).from(contacts).where(eq(contacts.id, fields.personId));
  if (!person) throw notFound('Persona no encontrada');
  const [project] = await getDb()
    .insert(projects)
    .values({ ...fields, createdBy: staffId })
    .returning();
  if (!project) throw conflict('No se pudo crear el proyecto');
  await getDb().insert(projectMembers).values({ projectId: project.id, profileId: staffId, role: 'admin' });
  return project;
}

export async function updateProject(id: string, fields: Partial<ProjectFields>) {
  await requireProject(id);
  if (fields.personId) {
    const [person] = await getDb().select({ id: contacts.id }).from(contacts).where(eq(contacts.id, fields.personId));
    if (!person) throw notFound('Persona no encontrada');
  }
  const [project] = await getDb()
    .update(projects)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  return project;
}

export async function deleteProject(id: string) {
  await requireProject(id);
  await getDb().delete(projects).where(eq(projects.id, id));
}

async function validateTaskParent(projectId: string, parentId: string | null | undefined, taskId?: string) {
  if (!parentId) return;
  if (parentId === taskId) throw badRequest('Una tarea no puede ser su propia subtarea');
  const parent = await requireTask(parentId);
  if (parent.projectId !== projectId) throw badRequest('La subtarea debe pertenecer al mismo proyecto');
  if (parent.parentId) throw badRequest('Las subtareas no pueden tener subtareas');
}

export async function createTask(projectId: string, fields: TaskFields, staffId: string) {
  await requireProject(projectId);
  await validateTaskParent(projectId, fields.parentId);
  const [{ nextPosition } = { nextPosition: 0 }] = await getDb()
    .select({ nextPosition: sql<number>`coalesce(max(${tasks.position}), -1) + 1` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, fields.status ?? 'todo'), fields.parentId ? eq(tasks.parentId, fields.parentId) : sql`${tasks.parentId} is null`));
  const [task] = await getDb()
    .insert(tasks)
    .values({
      projectId,
      title: fields.title,
      description: fields.description ?? null,
      status: fields.status ?? 'todo',
      priority: fields.priority ?? 'medium',
      dueDate: fields.dueDate ?? null,
      assigneeId: fields.assigneeId ?? null,
      assigneeName: fields.assigneeName ?? null,
      parentId: fields.parentId ?? null,
      createdBy: staffId,
      position: nextPosition,
    })
    .returning();
  if (!task) throw conflict('No se pudo crear la tarea');
  await getDb().update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  const detail = await getProjectDetail(projectId);
  return detail.tasks.find((item) => item.id === task.id) ?? task;
}

export async function updateTask(id: string, fields: Partial<TaskFields> & { position?: number }) {
  const current = await requireTask(id);
  await validateTaskParent(current.projectId, fields.parentId, id);
  await getDb()
    .update(tasks)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  await getDb().update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, current.projectId));
  const detail = await getProjectDetail(current.projectId);
  const task = detail.tasks.find((item) => item.id === id);
  if (!task) throw notFound('Tarea no encontrada');
  return task;
}

export async function deleteTask(id: string) {
  const task = await requireTask(id);
  await getDb().delete(tasks).where(eq(tasks.id, id));
  await getDb().update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, task.projectId));
}

export async function addComment(taskId: string, content: string, authorId: string) {
  await requireTask(taskId);
  const [comment] = await getDb().insert(comments).values({ taskId, content, authorId }).returning();
  if (!comment) throw conflict('No se pudo crear el comentario');
  return comment;
}

export async function deleteComment(id: string) {
  const result = await getDb().delete(comments).where(eq(comments.id, id)).returning({ id: comments.id });
  if (!result.length) throw notFound('Comentario no encontrado');
}
