import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  /** Acciones de la sección (p. ej. «Agregar canal»), a la derecha del título. */
  actions?: ReactNode;
};

/** Cabecera común de las secciones del panel: icono de la sección, título, descripción y acciones. */
export function PageHeader({ icon: Icon, title, description, actions }: Props) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions}
    </header>
  );
}
