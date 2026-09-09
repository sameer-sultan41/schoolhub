"use client";

import { Fragment, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { MENU_SIDEBAR } from "@/config/menu.config";
import { MenuItem } from "@/config/types";
import { cn } from "@/lib/utils";
import { useMenu } from "@/hooks/use-menu";

export interface ToolbarHeadingProps {
  title?: string | ReactNode;
  description?: string | ReactNode;
}

function Toolbar({ children }: { children?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-5 pb-7.5">{children}</div>;
}

function ToolbarActions({ children }: { children?: ReactNode }) {
  return <div className="flex items-center gap-2.5">{children}</div>;
}

function ToolbarBreadcrumbs() {
  const pathname = usePathname();
  const { getBreadcrumb, isActive } = useMenu(pathname);
  const items: MenuItem[] = getBreadcrumb(MENU_SIDEBAR);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="[.header_&]:below-lg:hidden mb-2.5 flex items-center gap-1.25 text-xs font-medium lg:mb-0 lg:text-sm">
      <div className="breadcrumb flex items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const active = item.path ? isActive(item.path) : false;

          return (
            <Fragment key={index}>
              {item.path ? (
                <Link
                  href={item.path}
                  className={cn(
                    "flex items-center gap-1",
                    active ? "text-mono" : "text-muted-foreground hover:text-primary",
                  )}
                >
                  {item.title}
                </Link>
              ) : (
                <span className={cn(isLast ? "text-mono" : "text-muted-foreground")}>
                  {item.title}
                </span>
              )}
              {!isLast && <ChevronRight className="muted-foreground size-3.5" />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function ToolbarHeading({ title = "", description }: ToolbarHeadingProps) {
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

export { Toolbar, ToolbarActions, ToolbarBreadcrumbs, ToolbarHeading };
