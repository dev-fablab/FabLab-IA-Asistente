'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FolderKanban, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, unwrap } from '@/lib/api';
import type { ProjectListItem } from '@/lib/projects';

type Person = { id: string; name: string; email: string };

export function ProjectsManager() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personId, setPersonId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [projectsResponse, peopleResponse] = await Promise.all([
      api.api.admin.projects.$get(),
      api.api.admin.calendar.people.$get({ query: { page: '1' } }),
    ]);
    setProjects(await unwrap(projectsResponse));
    const peopleData = await unwrap<{ items: Person[] }>(peopleResponse);
    setPeople(peopleData.items);
  }, []);

  useEffect(() => {
    let ignore = false;
    const timer = window.setTimeout(() => void load().catch((e) => {
        if (!ignore) setError(e instanceof Error ? e.message : 'No se pudieron cargar los proyectos');
      }), 0);
    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await unwrap(
        await api.api.admin.projects.$post({ json: { name, description: description || null, personId } }),
      );
      setName('');
      setDescription('');
      setPersonId('');
      setOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el proyecto');
    }
  }

  async function deleteProject(project: ProjectListItem) {
    if (!window.confirm(`¿Eliminar el proyecto "${project.name}"? También se eliminarán sus tareas y comentarios.`)) return;
    setError('');
    try {
      await unwrap(await api.api.admin.projects[':id'].$delete({ param: { id: project.id } }));
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el proyecto');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground">Organiza el trabajo asociado a cada persona.</p>
        </div>
        <Button onClick={() => setOpen((value) => !value)}><Plus /> Nuevo proyecto</Button>
      </div>
      {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {open && (
        <Card>
          <CardHeader><CardTitle>Nuevo proyecto</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={createProject}>
              <div className="space-y-2"><Label htmlFor="project-name">Nombre</Label><Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} /></div>
              <div className="space-y-2"><Label>Persona</Label><Select value={personId} onValueChange={setPersonId} required><SelectTrigger><SelectValue placeholder="Selecciona una persona" /></SelectTrigger><SelectContent>{people.map((person) => <SelectItem key={person.id} value={person.id}>{person.name} · {person.email}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2 md:col-span-2"><Label htmlFor="project-description">Descripción</Label><Textarea id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} /></div>
              <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={!personId || !name.trim()}>Crear proyecto</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
      {projects.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground"><FolderKanban className="size-10" /><p>Aún no hay proyectos.</p></CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card className="h-full transition-colors hover:border-primary" key={project.id}>
              <Link href={`/admin/projects/${project.id}`} className="block">
                <CardHeader><CardTitle className="text-lg">{project.name}</CardTitle><p className="text-sm text-muted-foreground">{project.personName}</p></CardHeader>
                <CardContent><p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{project.description || 'Sin descripción'}</p><p className="mt-4 text-xs text-muted-foreground">{project.doneCount}/{project.taskCount} tareas completadas</p></CardContent>
              </Link>
              <div className="flex justify-end border-t px-6 py-3">
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void deleteProject(project)}>
                  <Trash2 className="mr-1 size-4" /> Eliminar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
