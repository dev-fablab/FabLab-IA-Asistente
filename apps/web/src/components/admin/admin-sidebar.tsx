'use client';

import { ChevronRight, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { BrandMark } from '@/components/brand-mark';
import { authClient } from '@/lib/auth-client';
import { adminNavItems, isWithin, type AdminNavItem } from './nav-items';

/**
 * Sección con subpáginas: un botón que despliega sus enlaces. Está abierta mientras se navega dentro de ella; si la
 * persona la abre o la cierra a mano, se respeta su elección hasta que cambie.
 */
function NavGroup({ item, pathname }: { item: AdminNavItem & { children: NonNullable<AdminNavItem['children']> }; pathname: string }) {
  const active = isWithin(pathname, item.href) || item.children.some((child) => isWithin(pathname, child.href));
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? active;
  const Icon = item.icon;

  return (
    <Collapsible open={open} onOpenChange={setChosen} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={active && !open} className="data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground">
            <Icon />
            <span>{item.label}</span>
            <ChevronRight className={`ml-auto transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub aria-label={item.label}>
            {item.children.map(({ href, label, icon: ChildIcon }) => (
              <SidebarMenuSubItem key={href}>
                <SidebarMenuSubButton
                  asChild
                  isActive={isWithin(pathname, href)}
                  className="data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:[&>svg]:text-sidebar-primary-foreground"
                >
                  <Link href={href} aria-current={isWithin(pathname, href) ? 'page' : undefined}>
                    <ChildIcon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function AdminSidebar({ email, role }: { email?: string; role?: 'admin' | 'staff' }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = adminNavItems.filter((item) => !item.adminOnly || role === 'admin');

  async function signOut() {
    await authClient.signOut();
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
              {items.map((item) =>
                item.children ? (
                  <NavGroup key={item.href} item={{ ...item, children: item.children }} pathname={pathname} />
                ) : (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isWithin(pathname, item.href)}
                      className="data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground"
                    >
                      <Link href={item.href} aria-current={isWithin(pathname, item.href) ? 'page' : undefined}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
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
