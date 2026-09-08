"use client";

import { usePathname } from "next/navigation";
import { SidebarMenuDashboard } from "./sidebar-menu-dashboard";
import { SidebarMenuDefault } from "./sidebar-menu-default";

export function SidebarSecondary() {
  const pathname = usePathname();

  return (
    <div className="kt-scrollable-y-hover my-5 max-h-[calc(100vh-2rem)] shrink-0 grow ps-3.5 pe-1">
      {pathname === "/" ? <SidebarMenuDashboard /> : <SidebarMenuDefault />}
    </div>
  );
}
