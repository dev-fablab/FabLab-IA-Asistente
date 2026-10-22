import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PeopleManager } from '@/components/admin/calendar/people-manager';

export const metadata: Metadata = { title: 'Personas · Panel Fab Lab' };

export default function PeoplePage() {
  // `useSearchParams` exige un límite de Suspense en Next.js.
  return (
    <Suspense>
      <PeopleManager />
    </Suspense>
  );
}
