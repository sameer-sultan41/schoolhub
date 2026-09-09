"use client";

import { Button, cn } from "@schoolhub/ui";
import { ChevronFirst } from "lucide-react";
import Link from "next/link";

/**
 * Copied from Metronic's own `sidebar-header.tsx`, substituting a text logo for
 * Metronic's own logo images (this repo has no equivalent SVG assets, and vendoring them
 * would add nothing to a styling comparison) and a plain `useState` toggle passed down
 * from `shell.tsx` in place of Metronic's own `useSettings` persistence layer — this
 * reference only needs to LOOK like Metronic, not persist a preference.
 */
export function SidebarHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="sidebar-header relative hidden shrink-0 items-center justify-between px-3 lg:flex lg:px-6">
      <Link href="/dev/metronic-reference" className="font-heading text-lg font-semibold">
        SchoolHub
      </Link>
      <Button
        onClick={onToggle}
        size="sm"
        mode="icon"
        variant="outline"
        className={cn(
          "absolute start-full top-2/4 size-7 -translate-x-2/4 -translate-y-2/4 rtl:translate-x-2/4",
          collapsed ? "ltr:rotate-180" : "rtl:rotate-180",
        )}
      >
        <ChevronFirst className="size-4!" />
      </Button>
    </div>
  );
}
