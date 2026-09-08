"use client";

import { Fragment, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
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
    <div className="mb-5 lg:mb-10">
      <Container className="flex flex-wrap items-center justify-between gap-5">
        {children}
      </Container>
    </div>
  );
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

const ToolbarHeading = ({ title = "" }: ToolbarHeadingProps) => {
  const pathname = usePathname();
  const { getCurrentItem } = useMenu(pathname);
  const item = getCurrentItem(MENU_SIDEBAR);

  return (
    <div className="flex flex-wrap items-center gap-1 lg:gap-5">
      <h1 className="text-mono text-lg font-medium">{title || item?.title}</h1>
      <ToolbarBreadcrumbs />
    </div>
  );
};

export { Toolbar, ToolbarActions, ToolbarBreadcrumbs, ToolbarHeading };
