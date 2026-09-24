"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { cn, useMenu, type MenuItem } from "@schoolhub/ui";

import { MENU_SIDEBAR } from "@/app/(app)/shell/menu-config";

/**
 * The header's one breadcrumb trail — on every route, every breakpoint. It used to be
 * three separate renderings of the same trail (a plain-text one here, a second copy in
 * `content.tsx` on mobile, and a third, richer one — `Home` root, links, active state —
 * duplicated per page inside `ToolbarBreadcrumbs`, e.g. the staff toolbar). This is that
 * richer version, consolidated to the one place a trail belongs: this is now the only
 * `Breadcrumb` in the app.
 *
 * `MENU_SIDEBAR` has no literal "Home" entry (its actual first entry is "Dashboards"), so
 * it's prepended here rather than derived from the menu tree — every page in this app's
 * own vendor reference gets a hardcoded Home crumb ahead of its real chain.
 */
const HOME_CRUMB: MenuItem = { title: "Home", path: "/dashboard" };

export function Breadcrumb() {
  const pathname = usePathname();
  const { getBreadcrumb, isActive } = useMenu(pathname);
  const chain = getBreadcrumb(MENU_SIDEBAR);

  if (chain.length === 0) return null;

  const items = [HOME_CRUMB, ...chain];

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center text-sm font-medium">
      <ol className="flex min-w-0 items-center">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const active = item.path ? isActive(item.path) : false;

          return (
            <Fragment key={item.path ?? item.title ?? index}>
              <li className={cn("min-w-0", isLast && "truncate")}>
                {item.path && !isLast ? (
                  <Link
                    href={item.path}
                    className={cn(
                      "truncate text-muted-foreground transition-colors hover:text-primary",
                      active && "text-foreground",
                    )}
                  >
                    {item.title}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      "truncate",
                      isLast ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                    aria-current={isLast ? "page" : undefined}
                  >
                    {item.title}
                  </span>
                )}
              </li>
              {!isLast && (
                <ChevronRight
                  aria-hidden="true"
                  className="mx-1.5 size-3.5 shrink-0 text-muted-foreground/60"
                />
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
