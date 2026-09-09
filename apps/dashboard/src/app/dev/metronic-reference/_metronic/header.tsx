"use client";

import { Button, cn } from "@schoolhub/ui";
import { LayoutGrid, Search } from "lucide-react";

/**
 * Trimmed copy of Metronic's own `header.tsx`: kept the fixed bar, the border treatment,
 * and the circular header icon-button styling (`shape="circle" size-9
 * hover:bg-primary/10`) that this reference exists to show off. Dropped the mega-menu,
 * search dialog, notifications sheet, chat sheet, and apps/user dropdowns — schoolhub's
 * real header already made the deliberate call not to port those (no backing feature
 * exists for any of them; see docs/project-status.md), so reproducing them here would
 * invite comparing against chrome the real app was never going to ship.
 */
export function Header() {
  return (
    <header
      className={cn(
        "header sticky top-0 z-10 flex shrink-0 items-stretch border-b border-border bg-background",
      )}
    >
      <div className="mx-auto flex w-full items-center justify-between gap-4 px-5 py-2.5 lg:px-7.5">
        <div className="text-lg font-semibold">Dashboard</div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            mode="icon"
            shape="circle"
            className="size-9 hover:bg-primary/10 hover:[&_svg]:text-primary"
          >
            <Search className="size-4.5!" />
          </Button>
          <Button
            variant="ghost"
            mode="icon"
            shape="circle"
            className="size-9 hover:bg-primary/10 hover:[&_svg]:text-primary"
          >
            <LayoutGrid className="size-4.5!" />
          </Button>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            SH
          </div>
        </div>
      </div>
    </header>
  );
}
