"use client";

import { SidebarMenuPrimary } from "./sidebar-menu-primary";
import { SidebarMenuSecondary } from "./sidebar-menu-secondary";

export function SidebarMenu() {
  return (
    <div className="kt-scrollable-y-auto max-h-[calc(100vh-11.5rem)] grow">
      <SidebarMenuPrimary />
      <div className="mx-5 my-4 border-b border-input"></div>
      <SidebarMenuSecondary />
    </div>
  );
}
