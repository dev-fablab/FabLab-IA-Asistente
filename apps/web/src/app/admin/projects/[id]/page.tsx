import type { Metadata } from 'next';
import { ProjectBoard } from '@/components/admin/projects/project-board';

export const metadata: Metadata = { title: 'Proyecto · Panel Fab Lab' };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return <ProjectBoard projectId={(await params).id} />;
}
