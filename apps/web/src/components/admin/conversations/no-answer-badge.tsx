import { CircleHelp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** Marca un turno que el asistente no pudo respaldar con documentos: es un vacío por documentar, no un error. */
export function NoAnswerBadge() {
  return (
    <Badge variant="warning">
      <CircleHelp aria-hidden />
      Sin información
    </Badge>
  );
}
