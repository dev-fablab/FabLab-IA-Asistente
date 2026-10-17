import { AlertCircle, CheckCircle2, Clock, Hourglass, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DocumentRow } from '@/lib/documents';

const STATUS = {
  pending: { label: 'Pendiente', variant: 'outline', icon: Clock },
  processing: { label: 'Procesando', variant: 'secondary', icon: Loader2 },
  ready: { label: 'Listo', variant: 'success', icon: CheckCircle2 },
  failed: { label: 'Falló', variant: 'destructive', icon: AlertCircle },
} as const;

export function StatusBadge({ document }: { document: Pick<DocumentRow, 'status' | 'stuck'> }) {
  const { label, variant, icon: StatusIcon } = STATUS[document.status];
  // Un documento atascado se muestra como tal (en ámbar, con un reloj de arena): se puede reintentar.
  const stuck = document.status === 'processing' && document.stuck;
  const text = stuck ? 'Atascado' : label;
  const Icon = stuck ? Hourglass : StatusIcon;

  return (
    <Badge variant={document.stuck ? 'warning' : variant}>
      <Icon className={document.status === 'processing' && !document.stuck ? 'animate-spin' : undefined} aria-hidden />
      {text}
    </Badge>
  );
}
