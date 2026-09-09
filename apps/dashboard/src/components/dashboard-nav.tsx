"use client";

import {
  AccordionMenu,
  AccordionMenuGroup,
  AccordionMenuItem,
  AccordionMenuLabel,
  Badge,
  type AccordionMenuClassNames,
  useSidebar,
} from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { NavGroup, NavItem } from "@/lib/nav-items";

/**
 * classNames ported literally from Metronic's own
 * packages/ui/src/components/layouts/demo1/components/sidebar-menu.tsx (reference-only,
 * excluded from this package's build — see docs/metronic-dashboard-shell.md). The
 * group-data-[collapsible=icon]: additions are this app's own fix for a real Metronic gap:
 * upstream has no icon-only collapsed state at all, so nothing there hides label/badge
 * text when the rail collapses to its icon rail.
 */
const navClassNames: AccordionMenuClassNames = {
  root: "lg:ps-1 space-y-3",
  group: "gap-px",
  label:
    "uppercase text-xs font-medium text-muted-foreground/70 pt-2.25 pb-px group-data-[collapsible=icon]:hidden",
  item: "h-8 hover:bg-transparent text-accent-foreground hover:text-primary data-[selected=true]:text-primary data-[selected=true]:bg-muted data-[selected=true]:font-medium group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!",
};

/**
 * Rendered inside SidebarProvider so it can reach useSidebar() — needed for exactly one
 * thing: closing the mobile drawer on navigation. setOpenMobile is a no-op on desktop.
 */
export function DashboardNav({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  const t = useTranslations("nav");
  const { setOpenMobile } = useSidebar();

  const isActive = (item: NavItem) =>
    pathname === item.href || pathname.startsWith(`${item.href}/`);

  function renderItem(item: NavItem) {
    const label = t(item.key);
    const Icon = item.icon;

    if (item.status === "planned") {
      const badgeId = `nav-planned-${item.key}`;
      return (
        <AccordionMenuItem
          key={item.key}
          value={item.key}
          aria-disabled="true"
          aria-describedby={badgeId}
          title={t("plannedHint", { module: label })}
        >
          <Icon aria-hidden="true" />
          <span className="group-data-[collapsible=icon]:hidden">{label}</span>
          <Badge
            id={badgeId}
            aria-hidden="true"
            variant="secondary"
            size="sm"
            className="ms-auto me-[-10px] group-data-[collapsible=icon]:hidden"
          >
            {t("planned")}
          </Badge>
        </AccordionMenuItem>
      );
    }

    const active = isActive(item);
    return (
      <AccordionMenuItem key={item.key} value={item.key} asChild>
        <Link
          href={item.href}
          title={label}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            setOpenMobile(false);
          }}
        >
          <Icon aria-hidden="true" />
          <span className="group-data-[collapsible=icon]:hidden">{label}</span>
        </Link>
      </AccordionMenuItem>
    );
  }

  return (
    // One landmark wrapping every group, not one per group.
    <nav aria-label={t("primary")}>
      <AccordionMenu
        type="single"
        collapsible
        classNames={navClassNames}
        matchPath={(href) => pathname === href || pathname.startsWith(`${href}/`)}
      >
        {groups.map((group) => (
          <AccordionMenuGroup key={group.key}>
            <AccordionMenuLabel>{t(`groups.${group.key}`)}</AccordionMenuLabel>
            {group.items.map(renderItem)}
          </AccordionMenuGroup>
        ))}
      </AccordionMenu>
    </nav>
  );
}
