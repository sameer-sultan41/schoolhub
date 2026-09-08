"use client";

import { SidebarPrimary } from "./sidebar-primary";
import { SidebarSecondary } from "./sidebar-secondary";

export function Sidebar() {
  return (
    <div className="fixed top-0 bottom-0 z-20 flex w-(--sidebar-width) shrink-0 items-stretch bg-muted">
      <SidebarPrimary />
      <SidebarSecondary />
    </div>
  );
}
