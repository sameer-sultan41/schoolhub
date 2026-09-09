"use client";

import {
  AccordionMenu,
  type AccordionMenuClassNames,
  AccordionMenuGroup,
  AccordionMenuItem,
  AccordionMenuLabel,
  Badge,
  useSidebar,
} from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { NavGroup, NavItem } from "@/lib/nav-items";

/**
 * Metronic's own `sidebar-menu.tsx` classNames, verbatim (`lg:ps-1 space-y-3` /
 * `gap-px` / the exact label and item strings, confirmed against a live render of that
 * file's actual, unmodified sidebar at apps/dashboard/src/app/dev/metronic-reference) —
 * plain page tokens (`muted`/`primary`/`accent-foreground`), not a sidebar-scoped
 * abstraction: now that `--sh-color-chrome-*` is itself aliased 1:1 to those same page
 * tokens (theme.css), there is no remaining daylight between "the sidebar's own tokens"
 * and "the page's", so matching Metronic's file directly is simpler than maintaining a
 * parallel `sidebar-*`-token version that resolves to the exact same values.
 * `group-data-[collapsible=icon]:` additions (not in Metronic's own file, which has no
 * icon-only rail mode at all) centre the icon and hide the label once the rail collapses
 * — schoolhub's own `collapsible="icon"` preference, layered on top of the same visual
 * base.
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
 * thing: closing the mobile drawer on navigation. SidebarProvider's own mobile state has
 * no navigation-awareness of its own (confirmed by a real e2e regression: without this,
 * the drawer stayed open behind the new page after a link click). setOpenMobile(false) is
 * a no-op on desktop, where there's no drawer to close.
 *
 * Built on AccordionMenu (@schoolhub/ui, ported from Metronic in accordion-menu.tsx), not
 * the flat SidebarMenu rendering this replaces — every group is its own AccordionMenuGroup
 * with an AccordionMenuLabel heading, and any item with `children` (NavItem.children)
 * would render as a nested, collapsible sub-group. NAV_GROUPS has no nested entries today,
 * so this only changes the rendering engine, not the visible tree.
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
        // A button, never a Link: these modules have no route, so a link here navigates
        // to a 404 that reads as a broken app rather than as a feature that hasn't
        // shipped. aria-disabled rather than `disabled`: a disabled button is removed
        // from the tab order entirely, so the one group of users who most need to be
        // told *why* nothing happens would never reach the badge that says so.
        <AccordionMenuItem
          key={item.key}
          value={item.key}
          aria-disabled="true"
          aria-describedby={badgeId}
          title={t("plannedHint", { module: label })}
        >
          <Icon aria-hidden="true" />
          <span className="group-data-[collapsible=icon]:hidden">{label}</span>
          {/* Metronic's own badge treatment for a disabled item, verbatim
              (variant="secondary" size="sm"). aria-hidden despite being visible: this
              badge lives inside the button that renders it, so without aria-hidden its
              text would fold into the button's own accessible NAME ("Fees & Finance
              Soon") instead of staying "Fees & Finance" with "Soon" as its DESCRIPTION —
              aria-describedby above still picks up this element's text for that purpose
              regardless of its hidden state, per the ARIA accessible-description
              computation. Hidden (not just this badge's own text) once the rail
              collapses to icon width — there's no room for a badge next to a bare icon,
              and title above already carries the same "coming soon" meaning to a mouse
              user hovering the icon. */}
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
          aria-current={active ? "page" : undefined}
          // A plain title attribute, not a full Tooltip primitive: the accessible-name
          // computation only falls back to `title` when there's no other naming source, so
          // this never touches the link's accessible name (already the visible label text)
          // — it only gives a mouse user hovering an icon-only collapsed rail something to
          // read.
          title={label}
          onClick={() => {
            setOpenMobile(false);
          }}
        >
          {/* aria-hidden and no label of its own: the accessible name of this link must
              be exactly the module's name. */}
          <Icon aria-hidden="true" />
          <span className="group-data-[collapsible=icon]:hidden">{label}</span>
        </Link>
      </AccordionMenuItem>
    );
  }

  return (
    // One landmark wrapping every group, not one per group: e2e's dashboard.page.ts scopes
    // every nav assertion to a single "Primary navigation" region, and a screen reader's
    // landmark list should offer one navigation here, not four.
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
