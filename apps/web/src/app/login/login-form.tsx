'use client';

import { AlertCircle, LoaderCircle, LogIn, Lock, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const { error: signInError } = await authClient.signIn.email({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    });

    if (signInError) {
      // Mensaje genérico: no revela si el correo existe.
      setError('Correo o contraseña incorrectos.');
      setPending(false);
      return;
    }

    router.replace('/admin/documents');
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm shadow-md">
      <CardHeader>
        {/* En pantallas pequeñas no se ve el panel de marca: el formulario lleva la suya. */}
        <BrandMark className="mb-2 lg:hidden" />
        <CardTitle className="text-lg">Panel de Fab Lab</CardTitle>
        <CardDescription>Ingresa con la cuenta que te creó un administrador.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Correo</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="email" name="email" type="email" autoComplete="username" required className="pl-8" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="password" name="password" type="password" autoComplete="current-password" required className="pl-8" />
            </div>
          </div>
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
            {pending ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
