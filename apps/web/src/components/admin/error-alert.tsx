import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Error de carga de una sección, con «Reintentar» cuando tiene sentido repetir la consulta. */
export function ErrorAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <span className="flex items-center gap-2 text-destructive">
        <AlertCircle className="size-4 shrink-0" aria-hidden /> {message}
      </span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden /> Reintentar
        </Button>
      )}
    </div>
  );
}
