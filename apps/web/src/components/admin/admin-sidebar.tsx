'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/client';
import { adminNavItems } from './nav-items';

export function AdminSidebar({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <Sidebar>
      {/* Franja roja del logo de INACAP sobre el carbón de la barra. */}
      <SidebarHeader className="border-t-[3px] border-brand px-4 py-4">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">Fab Lab · Asistente</span>
            <span className="text-xs text-sidebar-foreground/70">INACAP Talca</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestión</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminNavItems.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(href)}
                    className="data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground"
                  >
                    <Link href={href}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {email && (
            <SidebarMenuItem>
              <div className="flex items-center gap-2 px-2 py-1.5" title={email}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold uppercase" aria-hidden>
                  {email.charAt(0)}
                </span>
                <p className="truncate text-xs text-sidebar-foreground/80">{email}</p>
              </div>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut}>
              <LogOut />
              <span>Cerrar sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
