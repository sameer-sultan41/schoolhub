"use client";

import { usePathname } from "next/navigation";
import { SidebarMenuDashboard } from "./sidebar-menu-dashboard";
import { SidebarMenuDefault } from "./sidebar-menu-default";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex w-(--sidebar-width) shrink-0 items-stretch bg-background px-2">
      {pathname === "/" ? <SidebarMenuDashboard /> : <SidebarMenuDefault />}
    </div>
  );
}
