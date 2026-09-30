"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { useMenu } from "@schoolhub/ui";

import { MENU_SIDEBAR } from "@/config/menu-config";

// Ported verbatim from packages/ui's layouts/demo1/components/toolbar.tsx. Its own
// `ToolbarBreadcrumbs` was dropped — the header now renders the app's one breadcrumb
// trail (see header.tsx and breadcrumb.tsx), so a per-page copy here would repeat it.
export interface ToolbarHeadingProps {
  title?: string | ReactNode;
  description?: string | ReactNode;
  /** Title and description on one row, for a compact stat-pill description like /staff's. */
  inline?: boolean;
}

export function Toolbar({ children }: { children?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-5 pb-7.5">{children}</div>;
}

export function ToolbarActions({ children }: { children?: ReactNode }) {
  return <div className="flex items-center gap-2.5">{children}</div>;
}

export function ToolbarHeading({ title = "", description, inline = false }: ToolbarHeadingProps) {
  const pathname = usePathname();
  const { getCurrentItem } = useMenu(pathname);
  const item = getCurrentItem(MENU_SIDEBAR);
  // Only inline headings get the menu icon, so other title-less routes don't grow one.
  const Icon = inline && !title ? item?.icon : undefined;

  return (
    <div
      className={
        inline ? "flex flex-wrap items-center gap-4" : "flex flex-col justify-center gap-2"
      }
    >
      {/* Inline: bigger title next to the stat pill; h-8.5 matches Button md so the row aligns. */}
      <h1
        className={
          inline
            ? "text-mono flex h-8.5 items-center gap-2 text-2xl leading-none font-semibold"
            : "text-mono flex items-center gap-2 text-xl leading-none font-medium"
        }
      >
        {Icon && (
          <Icon
            className={inline ? "size-6 text-primary" : "size-5 text-primary"}
            aria-hidden="true"
          />
        )}
        {title || item?.title || "Untitled"}
      </h1>
      {description && (
        <div
          className={
            inline
              ? "flex h-8.5 items-center gap-2 text-sm font-normal text-muted-foreground"
              : "flex items-center gap-2 text-sm font-normal text-muted-foreground"
          }
        >
          {description}
        </div>
      )}
    </div>
  );
}
