"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Skeleton } from "@schoolhub/ui";
import { useTranslations } from "next-intl";

import type { PortalModules } from "@/services";
import { portalNavItems } from "./portal-nav-items";

const TAB_CLASS =
  "inline-flex items-center whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:text-foreground";

export interface PortalNavProps {
  /** `undefined` while the summary loads: a skeleton, never a guess at which tabs exist. */
  modules: PortalModules | undefined;
  studentId: string | undefined;
}

/** The portal's tabs, one per module the school has on (`summary.modules`). */
export function PortalNav({ modules, studentId }: PortalNavProps) {
  const t = useTranslations("portal.nav");
  const pathname = usePathname();

  if (modules === undefined) return <Skeleton className="h-9 w-full max-w-md" />;

  return (
    <nav aria-label={t("label")} className="border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {portalNavItems(modules, studentId).map((item) => {
          const isCurrent = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                className={TAB_CLASS}
              >
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
