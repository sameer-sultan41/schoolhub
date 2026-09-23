"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { cn, useMenu, type MenuItem } from "@schoolhub/ui";

import { MENU_SIDEBAR } from "@/app/(app)/shell/menu-config";

// Ported verbatim from packages/ui's layouts/demo1/components/breadcrumb.tsx.
export function Breadcrumb() {
  const pathname = usePathname();
  const { getBreadcrumb, isActive } = useMenu(pathname);
  const items: MenuItem[] = getBreadcrumb(MENU_SIDEBAR);

  if (items.length === 0) return null;

  return (
    <div className="mb-2.5 flex items-center gap-1.25 text-xs font-medium lg:mb-0 lg:text-sm">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const active = item.path ? isActive(item.path) : false;

        return (
          <Fragment key={`root-${index}`}>
            <span
              className={cn(active ? "text-mono" : "text-secondary-foreground")}
              key={`item-${index}`}
            >
              {item.title}
            </span>
            {!last && (
              <ChevronRight className="size-3.5 text-muted-foreground" key={`separator-${index}`} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
