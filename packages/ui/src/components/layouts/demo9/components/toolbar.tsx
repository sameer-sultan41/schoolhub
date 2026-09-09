"use client";

import { Fragment, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MENU_SIDEBAR } from "@/config/menu.config";
import { MenuItem } from "@/config/types";
import { cn } from "@/lib/utils";
import { useMenu } from "@/hooks/use-menu";
import { Container } from "@/components/common/container";

export interface ToolbarHeadingProps {
  title?: string | ReactNode;
  description?: string | ReactNode;
}

function Toolbar({ children }: { children?: ReactNode }) {
  return (
    <Container>
      <div className="la:gap-5 flex flex-wrap items-center justify-between gap-2 pb-7">
        {children}
      </div>
    </Container>
  );
}

function ToolbarActions({ children }: { children?: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}

function ToolbarBreadcrumbs() {
  const pathname = usePathname();
  const { getBreadcrumb, isActive } = useMenu(pathname);
  const items: MenuItem[] = getBreadcrumb(MENU_SIDEBAR);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 text-sm">
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
                  active ? "text-mono" : "text-secondary-foreground hover:text-primary",
                )}
              >
                {item.title}
              </Link>
            ) : (
              <span className={cn(isLast ? "text-mono" : "text-secondary-foreground")}>
                {item.title}
              </span>
            )}
            {!isLast && <span className="text-muted-foreground">/</span>}
          </Fragment>
        );
      })}
    </div>
  );
}

function ToolbarHeading({ title = "" }: ToolbarHeadingProps) {
  const pathname = usePathname();
  const { getCurrentItem } = useMenu(pathname);
  const item = getCurrentItem(MENU_SIDEBAR);

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-mono text-lg font-medium">{title || item?.title}</h1>
      <ToolbarBreadcrumbs />
    </div>
  );
}

export { Toolbar, ToolbarActions, ToolbarBreadcrumbs, ToolbarHeading };
