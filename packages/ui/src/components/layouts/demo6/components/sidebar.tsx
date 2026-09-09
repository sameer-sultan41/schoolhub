"use client";

import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarMenu } from "./sidebar-menu";

export function Sidebar() {
  return (
    <div className="fixed top-0 bottom-0 z-20 w-(--sidebar-width) shrink-0 flex-col bg-(--page-bg) lg:flex dark:bg-(--page-bg-dark)">
      <SidebarHeader />
      <SidebarMenu />
      <SidebarFooter />
    </div>
  );
}
