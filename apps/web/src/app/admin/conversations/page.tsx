import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConversationsManager } from '@/components/admin/conversations/conversations-manager';

export const metadata: Metadata = { title: 'Historial · Panel Fab Lab' };

export default function ConversationsPage() {
  // `useSearchParams` exige un límite de Suspense en Next.js.
  return (
    <Suspense>
      <ConversationsManager />
    </Suspense>
  );
}
