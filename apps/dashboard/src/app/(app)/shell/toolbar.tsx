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
  /** Puts the title and description on the same row instead of stacked — for a page
   * like `/staff` whose "description" is a compact stat pill, not a line of prose that
   * needs its own row (e.g. the dashboard's "Central Hub for Personal Customization"). */
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
  // Gated on `inline` (not just "no explicit title") so this stays scoped to the pages
  // that opted into the enhanced heading treatment — every OTHER route already renders
  // `<ToolbarHeading />` with no explicit title (e.g. `/students`'s bare placeholder
  // page), and un-gated this would silently grow an icon there too, a route this PR
  // never touches, mentions, or tests.
  const Icon = inline && !title ? item?.icon : undefined;

  return (
    <div
      className={
        inline ? "flex flex-wrap items-center gap-4" : "flex flex-col justify-center gap-2"
      }
    >
      {/* `inline` mode sits the title beside a stat pill whose own numbers are
          text-lg/font-semibold — text-xl/font-medium reads smaller next to that, even
          though it's technically the larger font size, so `inline` bumps to
          text-2xl/font-semibold to actually look like the dominant element it is.
          `h-8.5` on both the title and the description wrapper (matching Button's own
          "md" height) gives every piece of this row the SAME box height, so items-center
          lines them up on one shared vertical center instead of centering two
          differently-sized boxes against each other and against the toolbar's buttons. */}
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
