'use client';

import { UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  onFiles: (files: File[]) => void;
};

/** Zona de arrastre para subir varios `.pdf` y `.docx` a la vez; también funciona con teclado. */
export function UploadDropzone({ onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-card p-8 text-center transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <UploadCloud className="size-6" aria-hidden />
      </span>
      <p className="text-sm">
        Arrastra aquí tus archivos <strong>.pdf</strong> o <strong>.docx</strong> (hasta 20 MB cada uno)
      </p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-sm font-medium text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        o selecciónalos desde tu equipo
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        aria-label="Seleccionar documentos"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
