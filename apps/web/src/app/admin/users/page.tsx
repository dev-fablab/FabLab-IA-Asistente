import { getAuth, whenSeeded } from '@fablab/server/auth';
import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { AccessManager } from '@/components/admin/access/access-manager';
import { PageHeader } from '@/components/admin/page-header';

export const metadata: Metadata = { title: 'Accesos · Panel Fab Lab' };

export default async function UsersPage() {
  await whenSeeded();
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session?.user.role !== 'admin') {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <PageHeader
          icon={KeyRound}
          title="Accesos"
          description="Solo un administrador puede vincular correos, cambiar contraseñas y asignar roles."
        />
        <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">Tu rol no puede gestionar los accesos del panel.</p>
      </div>
    );
  }

  return <AccessManager />;
}
