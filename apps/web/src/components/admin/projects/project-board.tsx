'use client';

import { DndContext, type DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { ArrowLeft, CalendarDays, CheckCircle2, Circle, Flag, GripVertical, MessageSquare, Plus, Trash2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api, unwrap } from '@/lib/api';
import { PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUSES, type ProjectDetail, type ProjectTask } from '@/lib/projects';

type TeamMember = { id: string; fullName: string | null; email: string };
type Person = { id: string; name: string; email: string };
type TaskDraft = {
  title: string;
  description: string;
  priority: keyof typeof PRIORITY_LABELS;
  assigneeId: string;
  assigneeName: string;
  dueDate: string;
};

const EMPTY_DRAFT: TaskDraft = { title: '', description: '', priority: 'medium', assigneeId: 'unassigned', assigneeName: '', dueDate: '' };

const messageOf = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);

export function ProjectBoard({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [projectResponse, teamResponse, peopleResponse] = await Promise.all([
      api.api.admin.projects[':id'].$get({ param: { id: projectId } }),
      api.api.admin.team.$get(),
      api.api.admin.calendar.people.$get({ query: { page: '1' } }),
    ]);
    setDetail(await unwrap(projectResponse));
    setTeam((await unwrap<{ members: TeamMember[] }>(teamResponse)).members);
    setPeople((await unwrap<{ items: Person[] }>(peopleResponse)).items);
  }, [projectId]);

  useEffect(() => {
    let ignore = false;
    const timer = window.setTimeout(() => {
      void load().catch((cause) => {
        if (!ignore) setError(messageOf(cause, 'No se pudo cargar el proyecto'));
      });
    }, 0);
    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  const selected = detail?.tasks.find((task) => task.id === selectedId) ?? null;
  const rootTasks = useMemo(() => detail?.tasks.filter((task) => !task.parentId) ?? [], [detail]);
  const completed = rootTasks.filter((task) => task.status === 'done').length;
  const progress = rootTasks.length ? Math.round((completed / rootTasks.length) * 100) : 0;

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.api.admin.projects[':id'].tasks.$post({
        param: { id: projectId },
        json: {
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          priority: draft.priority,
          assigneeId: draft.assigneeId === 'unassigned' ? null : draft.assigneeId,
          assigneeName: draft.assigneeName.trim() || null,
          dueDate: draft.dueDate || null,
        },
      });
      const data = await unwrap<{ task: ProjectTask }>(response);
      setDetail((current) => (current ? { ...current, tasks: [...current.tasks, data.task] } : current));
      setDraft(EMPTY_DRAFT);
      setCreateOpen(false);
      setSelectedId(data.task.id);
    } catch (cause) {
      setError(messageOf(cause, 'No se pudo crear la tarea'));
    } finally {
      setBusy(false);
    }
  }

  async function patchTask(id: string, fields: Record<string, unknown>) {
    try {
      const response = await api.api.admin.projects.tasks[':id'].$patch({ param: { id }, json: fields });
      const data = await unwrap<{ task: ProjectTask }>(response);
      setDetail((current) => current && { ...current, tasks: current.tasks.map((task) => (task.id === id ? { ...task, ...data.task } : task)) });
    } catch (cause) {
      setError(messageOf(cause, 'No se pudo actualizar la tarea'));
    }
  }

  async function createSubtask(event: FormEvent) {
    event.preventDefault();
    if (!selected || !subtaskTitle.trim()) return;
    try {
      const response = await api.api.admin.projects[':id'].tasks.$post({
        param: { id: projectId },
        json: { title: subtaskTitle.trim(), parentId: selected.id },
      });
      const data = await unwrap<{ task: ProjectTask }>(response);
      setDetail((current) => (current ? { ...current, tasks: [...current.tasks, data.task] } : current));
      setSubtaskTitle('');
    } catch (cause) {
      setError(messageOf(cause, 'No se pudo crear la subtarea'));
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!selected || !commentText.trim()) return;
    try {
      const response = await api.api.admin.projects.tasks[':id'].comments.$post({
        param: { id: selected.id },
        json: { content: commentText.trim() },
      });
      const data = await unwrap<{ comment: ProjectDetail['comments'][number] }>(response);
      setDetail((current) => (current ? { ...current, comments: [...current.comments, data.comment] } : current));
      setCommentText('');
    } catch (cause) {
      setError(messageOf(cause, 'No se pudo guardar el comentario'));
    }
  }

  async function deleteTask() {
    if (!selected || !window.confirm('¿Eliminar esta tarea y sus subtareas?')) return;
    try {
      await unwrap(await api.api.admin.projects.tasks[':id'].$delete({ param: { id: selected.id } }));
      setDetail((current) => current && { ...current, tasks: current.tasks.filter((task) => task.id !== selected.id && task.parentId !== selected.id) });
      setSelectedId(null);
    } catch (cause) {
      setError(messageOf(cause, 'No se pudo eliminar la tarea'));
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const status = event.over?.id;
    if (status && TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) void patchTask(String(event.active.id), { status });
  }

  if (!detail) return <p className="text-sm text-muted-foreground">{error || 'Cargando proyecto…'}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/projects" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Proyectos</Link>
          <h1 className="text-2xl font-semibold">{detail.project.name}</h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground"><UserRound className="size-3.5" /> Asociado: {detail.project.personName}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus /> Nueva tarea</Button>
      </div>
      {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-4">
          <div><p className="text-xs text-muted-foreground">Progreso</p><p className="text-2xl font-semibold">{progress}%</p></div>
          <div className="min-w-52 flex-1"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{completed} de {rootTasks.length} tareas terminadas</span><span>{detail.tasks.filter((task) => task.parentId).length} subtareas</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div></div>
          <div className="flex gap-2 text-xs text-muted-foreground"><Badge variant="outline">{detail.comments.length} comentarios</Badge><Badge variant="outline">{detail.members.length} miembros</Badge></div>
        </CardContent>
      </Card>
      <DndContext onDragEnd={handleDragEnd}>
        <div className="grid gap-4 lg:grid-cols-3">
          {TASK_STATUSES.map((status) => <BoardColumn key={status} status={status} tasks={rootTasks.filter((task) => task.status === status)} allTasks={detail.tasks} comments={detail.comments} people={people} onSelect={setSelectedId} />)}
        </div>
      </DndContext>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nueva tarea</DialogTitle><DialogDescription>Define el trabajo, su prioridad y quién lo llevará.</DialogDescription></DialogHeader>
          <form onSubmit={createTask} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="task-title">Título</Label><Input id="task-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ej. Preparar prototipo" autoFocus required /></div>
            <div className="space-y-2"><Label htmlFor="task-description">Descripción</Label><Textarea id="task-description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Qué hay que hacer…" /></div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldSelect label="Prioridad" value={draft.priority} onChange={(value) => setDraft({ ...draft, priority: value as TaskDraft['priority'] })} options={Object.entries(PRIORITY_LABELS)} />
              <FieldSelect label="Responsable" value={draft.assigneeId} onChange={(value) => {
                const person = people.find((item) => `contact:${item.id}` === value);
                const member = team.find((item) => item.id === value);
                setDraft({ ...draft, assigneeId: person ? 'unassigned' : value, assigneeName: person ? person.name : member?.fullName ?? '' });
              }} options={[['unassigned', 'Sin asignar'], ...team.map((member) => [member.id, member.fullName || member.email]), ...people.map((person) => [`contact:${person.id}`, `${person.name} (Persona)`])]} />
              <div className="space-y-2"><Label htmlFor="task-due-date">Fecha límite</Label><Input id="task-due-date" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></div>
            </div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy || !draft.title.trim()}>{busy ? 'Guardando…' : 'Crear tarea'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && <TaskDetail task={selected} allTasks={detail.tasks} comments={detail.comments.filter((comment) => comment.taskId === selected.id)} team={team} people={people} subtaskTitle={subtaskTitle} setSubtaskTitle={setSubtaskTitle} commentText={commentText} setCommentText={setCommentText} onPatch={patchTask} onCreateSubtask={createSubtask} onComment={addComment} onDelete={deleteTask} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return <div className="space-y-2"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.map(([optionValue, optionLabel]) => { const safeValue = optionValue ?? ''; return <SelectItem key={safeValue} value={safeValue}>{optionLabel ?? safeValue}</SelectItem>; })}</SelectContent></Select></div>;
}

function BoardColumn({ status, tasks, allTasks, comments, people, onSelect }: { status: (typeof TASK_STATUSES)[number]; tasks: ProjectTask[]; allTasks: ProjectTask[]; comments: ProjectDetail['comments']; people: Person[]; onSelect: (id: string) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  return <section ref={setNodeRef} className={`min-h-64 rounded-xl border bg-muted/30 p-3 ${isOver ? 'ring-2 ring-primary' : ''}`}><div className="mb-3 flex items-center justify-between"><div><h2 className="font-medium">{TASK_STATUS_LABELS[status]}</h2><p className="text-xs text-muted-foreground">{tasks.length} {tasks.length === 1 ? 'tarea' : 'tareas'}</p></div><Badge variant="secondary">{tasks.length}</Badge></div><div className="space-y-3">{tasks.map((task) => <TaskCard key={task.id} task={task} assigneeLabel={people.find((person) => person.email.toLowerCase() === task.assigneeName?.toLowerCase())?.name ?? task.assigneeName} subtaskCount={allTasks.filter((item) => item.parentId === task.id).length} commentCount={comments.filter((comment) => comment.taskId === task.id).length} onSelect={onSelect} />)}</div></section>;
}

function TaskCard({ task, assigneeLabel, subtaskCount, commentCount, onSelect }: { task: ProjectTask; assigneeLabel?: string | null; subtaskCount: number; commentCount: number; onSelect: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const hasDetails = Boolean(task.description || task.dueDate);
  return <Card ref={setNodeRef} style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined} onClick={() => onSelect(task.id)} className={`transition-shadow hover:border-primary hover:shadow-md ${isDragging ? 'opacity-50' : ''}`}><CardHeader className="p-4 pb-2"><div className="flex items-start gap-2"><button type="button" className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground" aria-label={`Mover ${task.title}`} ref={setActivatorNodeRef} {...listeners} {...attributes}><GripVertical className="size-4" /></button><CardTitle className="text-sm">{task.title}</CardTitle></div></CardHeader><CardContent className="space-y-3 p-4 pt-0"><div className="flex flex-wrap gap-1.5"><Badge variant={task.priority === 'urgent' ? 'destructive' : 'outline'}><Flag className="mr-1 size-3" />{PRIORITY_LABELS[task.priority]}</Badge>{task.dueDate && <Badge variant="outline"><CalendarDays className="mr-1 size-3" />{task.dueDate}</Badge>}</div>{hasDetails && task.description && <div className="text-xs text-muted-foreground"><span className="truncate">{task.description}</span></div>}<div className="flex items-center gap-3 border-t pt-2 text-xs text-muted-foreground">{assigneeLabel ? <span className="flex min-w-0 items-center gap-1 truncate" title={`Responsable: ${assigneeLabel}`}><UserRound className="size-3.5 shrink-0" />{assigneeLabel}</span> : <span className="flex items-center gap-1 text-amber-600"><UserRound className="size-3.5" />Sin asignar</span>}{subtaskCount > 0 && <span className="flex items-center gap-1"><CheckCircle2 className="size-3.5" />{subtaskCount}</span>}{commentCount > 0 && <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />{commentCount}</span>}</div></CardContent></Card>;
}

function getAssigneeValue(task: ProjectTask, team: TeamMember[], people: Person[]) {
  if (task.assigneeId && team.some((member) => member.id === task.assigneeId)) return task.assigneeId;
  const person = people.find((item) => item.name === task.assigneeName || item.email.toLowerCase() === task.assigneeName?.toLowerCase());
  return person ? `person:${person.id}` : 'unassigned';
}

function TaskDetail({ task, allTasks, comments, team, people, subtaskTitle, setSubtaskTitle, commentText, setCommentText, onPatch, onCreateSubtask, onComment, onDelete }: { task: ProjectTask; allTasks: ProjectTask[]; comments: ProjectDetail['comments']; team: TeamMember[]; people: Person[]; subtaskTitle: string; setSubtaskTitle: (value: string) => void; commentText: string; setCommentText: (value: string) => void; onPatch: (id: string, fields: Record<string, unknown>) => Promise<void>; onCreateSubtask: (event: FormEvent) => Promise<void>; onComment: (event: FormEvent) => Promise<void>; onDelete: () => Promise<void> }) {
  const subtasks = allTasks.filter((item) => item.parentId === task.id);
  const doneSubtasks = subtasks.filter((item) => item.status === 'done').length;
  const displayAssignee = people.find((person) => person.email.toLowerCase() === task.assigneeName?.toLowerCase())?.name ?? task.assigneeName;
  const selectedAssigneeValue = getAssigneeValue(task, team, people);
  return <><SheetHeader className="border-b pr-12"><SheetTitle>{task.title}</SheetTitle><SheetDescription className="flex items-center gap-2"><span>{doneSubtasks}/{subtasks.length} subtareas completadas</span>{displayAssignee ? <Badge variant="secondary"><UserRound className="mr-1 size-3" />{displayAssignee}</Badge> : <Badge variant="outline">Sin responsable</Badge>}</SheetDescription></SheetHeader><div className="space-y-6 p-4">
    <section className="rounded-xl border bg-muted/20 p-4"><div className="mb-3 flex items-center gap-2"><div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="size-4" /></div><div><h3 className="font-medium">Responsable</h3><p className="text-xs text-muted-foreground">{displayAssignee ?? 'Esta tarea aún no tiene responsable'}</p></div></div><FieldSelect label="Asignar a una persona o integrante" value={selectedAssigneeValue} onChange={(value) => { const member = team.find((item) => item.id === value); const person = people.find((item) => `person:${item.id}` === value); void onPatch(task.id, { assigneeId: member?.id ?? null, assigneeName: member?.fullName || member?.email || person?.name || null }); }} options={[['unassigned', 'Sin asignar'], ...team.map((member) => [member.id, member.fullName || member.email]), ...people.map((person) => [`person:${person.id}`, `${person.name} · Persona`])]} /></section>
    <div className="grid gap-3 sm:grid-cols-3"><FieldSelect label="Estado" value={task.status} onChange={(value) => void onPatch(task.id, { status: value })} options={TASK_STATUSES.map((status) => [status, TASK_STATUS_LABELS[status]])} /><FieldSelect label="Prioridad" value={task.priority} onChange={(value) => void onPatch(task.id, { priority: value })} options={Object.entries(PRIORITY_LABELS)} /><div className="space-y-2"><Label>Fecha límite</Label><Input type="date" value={task.dueDate ?? ''} onChange={(event) => void onPatch(task.id, { dueDate: event.target.value || null })} /></div></div>
    <div className="space-y-2"><Label>Descripción</Label><Textarea defaultValue={task.description ?? ''} onBlur={(event) => { if (event.target.value !== (task.description ?? '')) void onPatch(task.id, { description: event.target.value || null }); }} placeholder="Añade contexto a esta tarea…" /></div>
    <section className="space-y-3 rounded-xl border p-4"><div className="flex items-center justify-between"><div><h3 className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-primary" /> Subtareas</h3><p className="text-xs text-muted-foreground">Divide esta tarea en pasos pequeños</p></div><Badge variant="secondary">{doneSubtasks}/{subtasks.length}</Badge></div>{subtasks.length === 0 && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Aún no hay subtareas. Agrega el primer paso.</p>}{subtasks.map((subtask) => <button type="button" key={subtask.id} className="flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm hover:bg-muted" onClick={() => void onPatch(subtask.id, { status: subtask.status === 'done' ? 'todo' : 'done' })}>{subtask.status === 'done' ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4 text-muted-foreground" />}{subtask.title}</button>)}<form className="flex gap-2" onSubmit={onCreateSubtask}><Input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Ej. Validar con el equipo" /><Button type="submit" variant="outline" disabled={!subtaskTitle.trim()}><Plus className="mr-1 size-4" /> Añadir</Button></form></section>
    <section className="space-y-3 rounded-xl border p-4"><div className="flex items-center justify-between"><div><h3 className="flex items-center gap-2 font-medium"><MessageSquare className="size-4 text-primary" /> Comentarios</h3><p className="text-xs text-muted-foreground">Comparte avances o bloqueos con el equipo</p></div><Badge variant="secondary">{comments.length}</Badge></div>{comments.length === 0 && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Sé el primero en dejar un comentario.</p>}{comments.map((comment) => <div key={comment.id} className="rounded-lg border bg-muted/30 p-3 text-sm"><p>{comment.content}</p><p className="mt-2 text-xs text-muted-foreground">{comment.authorName}</p></div>)}<form className="space-y-2" onSubmit={onComment}><Textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Escribe un comentario para el equipo…" /><div className="flex justify-end"><Button type="submit" disabled={!commentText.trim()}><MessageSquare className="mr-1 size-4" /> Publicar comentario</Button></div></form></section>
    <Button variant="destructive" className="w-full" onClick={() => void onDelete()}><Trash2 /> Eliminar tarea</Button>
  </div></>;
}
