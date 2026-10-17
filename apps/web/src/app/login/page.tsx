import { Cog, FileText, MessagesSquare, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { BrandMark } from '@/components/brand-mark';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Iniciar sesión · Fab Lab' };

const HIGHLIGHTS = [
  { icon: FileText, text: 'Documentos que alimentan al asistente' },
  { icon: MessagesSquare, text: 'Historial y vacíos por documentar' },
  { icon: Phone, text: 'Canales oficiales de contacto' },
] as const;

export default function LoginPage() {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      {/* Carbón y rojo del logo de INACAP; en pantallas pequeñas se oculta y queda solo el formulario. */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="absolute inset-x-0 top-0 h-1 bg-brand" aria-hidden />
        <Cog className="absolute -right-24 -bottom-24 size-[28rem] text-white/5" aria-hidden strokeWidth={1} />
        <div className="flex items-center gap-3">
          <BrandMark className="size-11" />
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-semibold">Fab Lab · Asistente</span>
            <span className="text-sm text-sidebar-foreground/70">INACAP Talca</span>
          </div>
        </div>
        <div className="relative flex flex-col gap-6">
          <h2 className="max-w-md text-3xl font-semibold tracking-tight">Panel de administración del asistente virtual</h2>
          <ul className="flex flex-col gap-3 text-sm text-sidebar-foreground/80">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex items-center justify-center bg-muted/40 p-4">
        <LoginForm />
      </section>
    </main>
  );
}
