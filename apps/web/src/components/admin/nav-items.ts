import { CalendarClock, CalendarDays, FileText, FolderKanban, MessagesSquare, Phone, Sparkle, Users, type LucideIcon } from 'lucide-react';

export type AdminNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Una sección del sidebar. Con `children` es un grupo desplegable.
 * Está activa si la ruta cae en `href` o en cualquiera de sus páginas.
 */
export type AdminNavItem = AdminNavLink & { children?: AdminNavLink[]; adminOnly?: boolean };

// Conocimiento (Documentos y Contacto), Historial y Calendario (Personas y Agenda). El Inventario (fase
// posterior) se agrega aquí sin rediseñar el sidebar.
export const adminNavItems: AdminNavItem[] = [
  {
    // No es una ruta: Documentos y Contacto no comparten prefijo. Sirve de clave del grupo.
    href: '/admin/conocimiento',
    label: 'Conocimiento',
    icon: Sparkle,
    children: [
      { href: '/admin/documents', label: 'Documentos', icon: FileText },
      { href: '/admin/contact', label: 'Contacto', icon: Phone },
    ],
  },
  { href: '/admin/conversations', label: 'Historial', icon: MessagesSquare },
  { href: '/admin/projects', label: 'Proyectos', icon: FolderKanban },
  {
    href: '/admin/calendar',
    label: 'Calendario',
    icon: CalendarDays,
    children: [
      { href: '/admin/calendar/people', label: 'Personas', icon: Users },
      { href: '/admin/calendar/agenda', label: 'Agenda', icon: CalendarClock },
    ],
  },
];

/** ¿Está la ruta actual dentro de esta página o de alguna de sus subpáginas? */
export const isWithin = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
