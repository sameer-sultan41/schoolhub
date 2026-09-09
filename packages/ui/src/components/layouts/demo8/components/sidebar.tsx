"use client";

import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarMenu } from "./sidebar-menu";

export function Sidebar() {
  return (
    <div className="fixed top-0 bottom-0 z-20 flex w-(--sidebar-width) shrink-0 grow flex-col items-stretch bg-muted">
      <SidebarHeader />
      <SidebarMenu />
      <SidebarFooter />
    </div>
  );
}
