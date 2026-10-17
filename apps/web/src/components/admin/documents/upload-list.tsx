'use client';

import { AlertCircle, FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { UploadItem } from './use-uploads';

type Props = {
  items: UploadItem[];
  onDismiss: (key: string) => void;
};

/** Subidas en curso y archivos rechazados, cada uno con su progreso o su motivo. */
export function UploadList({ items, onDismiss }: Props) {
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2" aria-label="Subidas en curso">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-sm shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 font-medium" title={item.fileName}>
              <FileUp className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{item.fileName}</span>
            </span>
            {item.phase === 'error' && (
              <Button variant="ghost" size="icon-sm" aria-label={`Descartar ${item.fileName}`} onClick={() => onDismiss(item.key)}>
                <X />
              </Button>
            )}
          </div>

          {item.phase === 'error' ? (
            <p role="alert" className="flex items-center gap-1.5 text-destructive">
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              {item.error}
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <Progress value={item.progress} aria-label={`Progreso de ${item.fileName}`} />
              <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                {item.phase === 'uploading' ? `Subiendo… ${item.progress}%` : 'Iniciando proceso…'}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
