"use client";

import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarMenu } from "./sidebar-menu";

export function Sidebar() {
  return (
    <div className="dark fixed top-0 bottom-0 z-20 w-(--sidebar-width) shrink-0 flex-col items-stretch lg:flex">
      <SidebarHeader />
      <SidebarMenu />
      <SidebarFooter />
    </div>
  );
}
