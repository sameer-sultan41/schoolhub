"use client";

import { SidebarMenuPrimary } from "./sidebar-menu-primary";
import { SidebarMenuSecondary } from "./sidebar-menu-secondary";

export function SidebarMenu() {
  return (
    <div className="kt-scrollable-y-auto my-5 max-h-[calc(100vh-13rem)] shrink-0 grow space-y-5 [--scrollbar-thumb-color:var(--input)]">
      <SidebarMenuPrimary />
      <SidebarMenuSecondary />
    </div>
  );
}
