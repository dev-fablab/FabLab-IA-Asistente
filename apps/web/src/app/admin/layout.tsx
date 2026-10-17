import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { BrandMark } from '@/components/brand-mark';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { createClient } from '@/lib/supabase/server';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // El proxy ya redirige sin sesión; esto cubre el caso en que no se ejecute.
  // La seguridad real de los datos está en la API (requireStaff).
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/login');

  return (
    <SidebarProvider>
      <AdminSidebar email={typeof data.claims.email === 'string' ? data.claims.email : undefined} />
      <SidebarInset className="bg-muted/40">
        <header className="flex h-14 items-center gap-3 border-t-[3px] border-brand border-b border-b-border bg-background px-4 md:hidden">
          <SidebarTrigger aria-label="Abrir menú" />
          <BrandMark className="size-7 rounded-md [&>svg]:size-4" />
          <span className="text-sm font-semibold">Panel de Fab Lab</span>
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
