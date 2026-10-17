import { Cog } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Marca del asistente: el rojo del logo de INACAP con un engranaje (fabricación digital). No usa el logo
 * oficial; para ponerlo, reemplaza el contenido de este componente por la imagen institucional.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white shadow-sm', className)}>
      <Cog className="size-5" aria-hidden />
    </span>
  );
}
