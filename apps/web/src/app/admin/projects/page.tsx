import type { Metadata } from 'next';
import { ProjectsManager } from '@/components/admin/projects/projects-manager';

export const metadata: Metadata = { title: 'Proyectos · Panel Fab Lab' };

export default function ProjectsPage() {
  return <ProjectsManager />;
}
