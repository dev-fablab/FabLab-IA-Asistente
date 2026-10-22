import { redirect } from 'next/navigation';

/** «Calendario» es el grupo del sidebar: su página principal es la agenda. Así siguen funcionando los enlaces antiguos. */
export default function CalendarPage() {
  redirect('/admin/calendar/agenda');
}
