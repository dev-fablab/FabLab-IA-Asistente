import { FileText, MessagesSquare, Phone, type LucideIcon } from 'lucide-react';

export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

// Fase 1: tres secciones. Calendario e Inventario (fases posteriores) se agregan aquí
// sin rediseñar el sidebar.
export const adminNavItems: AdminNavItem[] = [
  { href: '/admin/documents', label: 'Documentos', icon: FileText },
  { href: '/admin/conversations', label: 'Historial', icon: MessagesSquare },
  { href: '/admin/contact', label: 'Contacto', icon: Phone },
];
