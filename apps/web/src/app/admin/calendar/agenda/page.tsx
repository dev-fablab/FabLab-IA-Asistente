import type { Metadata } from 'next';
import { CalendarManager } from '@/components/admin/calendar/calendar-manager';

export const metadata: Metadata = { title: 'Agenda · Panel Fab Lab' };

export default function AgendaPage() {
  return <CalendarManager />;
}
