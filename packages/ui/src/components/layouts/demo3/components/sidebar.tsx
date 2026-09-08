"use client";

import { SidebarMenu } from "./sidebar-menu";

export function Sidebar() {
  return (
    <div className="group fixed top-0 bottom-0 z-20 w-(--sidebar-width) shrink-0 flex-col items-stretch py-3 lg:top-(--header-height) lg:flex lg:py-0">
      <div className="flex shrink-0 grow">
        <div className="kt-scrollable-y-auto flex max-h-[calc(100vh-3rem)] shrink-0 grow flex-col items-center gap-2.5">
          <SidebarMenu />
        </div>
      </div>
    </div>
  );
}
