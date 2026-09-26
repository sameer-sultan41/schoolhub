"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { useMenu } from "@schoolhub/ui";

import { MENU_SIDEBAR } from "@/app/(app)/shell/menu-config";

// Ported verbatim from packages/ui's layouts/demo1/components/toolbar.tsx. Its own
// `ToolbarBreadcrumbs` was dropped — the header now renders the app's one breadcrumb
// trail (see header.tsx and breadcrumb.tsx), so a per-page copy here would repeat it.
export interface ToolbarHeadingProps {
  title?: string | ReactNode;
  description?: string | ReactNode;
}

export function Toolbar({ children }: { children?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-5 pb-7.5">{children}</div>;
}

export function ToolbarActions({ children }: { children?: ReactNode }) {
  return <div className="flex items-center gap-2.5">{children}</div>;
}

export function ToolbarHeading({ title = "", description }: ToolbarHeadingProps) {
  const pathname = usePathname();
  const { getCurrentItem } = useMenu(pathname);
  const item = getCurrentItem(MENU_SIDEBAR);

  return (
    <div className="flex flex-col justify-center gap-2">
      <h1 className="text-mono text-xl leading-none font-medium">
        {title || item?.title || "Untitled"}
      </h1>
      {description && (
        <div className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
          {description}
        </div>
      )}
    </div>
  );
}
