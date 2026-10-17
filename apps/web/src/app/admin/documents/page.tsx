import type { Metadata } from 'next';
import { DocumentsManager } from '@/components/admin/documents/documents-manager';

export const metadata: Metadata = { title: 'Documentos · Panel Fab Lab' };

export default function DocumentsPage() {
  return <DocumentsManager />;
}
