"use client";

import {
  AccordionMenu,
  type AccordionMenuClassNames,
  AccordionMenuGroup,
  AccordionMenuItem,
  AccordionMenuLabel,
  useSidebar,
} from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { NavGroup, NavItem } from "@/lib/nav-items";

/**
 * AccordionMenu's own default item styling (accordion-menu.tsx's `itemVariants`) hardcodes
 * PAGE tokens (`hover:bg-accent`, `text-accent-foreground`) — the same class of bug this
 * repo's Button already documents for `ghost`/`outline` on a frame surface (see
 * `chrome-ghost`/`chrome-outline` in button.tsx): a hover fill built for the page can land
 * at low contrast, or invert entirely, against the sidebar rail. This override, matching
 * Metronic's own `sidebar-menu.tsx` classNames (text-colour-only hover, a muted fill only
 * once selected) but pointed at this repo's `sidebar-*` tokens instead of Metronic's plain
 * `muted`/`primary`, is what actually makes this render as the sidebar frame rather than
 * page content that happens to sit inside it.
 */
const navClassNames: AccordionMenuClassNames = {
  root: "space-y-3",
  label:
    "px-2 pt-2.5 pb-1 text-[0.6875rem] font-semibold tracking-wider text-sidebar-foreground/70 uppercase",
  item: "h-8 rounded-md px-2 text-sidebar-foreground hover:bg-transparent hover:text-sidebar-primary data-[selected=true]:bg-sidebar-accent data-[selected=true]:text-sidebar-accent-foreground data-[selected=true]:font-medium",
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
          <span>{label}</span>
          {/* A pill, not a bare numeral-style badge: "Soon" is a word, not a count.
              aria-hidden despite being visible: this span lives inside the button that
              renders it, so without aria-hidden its text would fold into the button's own
              accessible NAME ("Fees & Finance Soon") instead of staying "Fees & Finance"
              with "Soon" as its DESCRIPTION — aria-describedby above still picks up this
              element's text for that purpose regardless of its hidden state, per the ARIA
              accessible-description computation. */}
          <span
            id={badgeId}
            aria-hidden="true"
            className="ms-auto rounded-full bg-sidebar-foreground/10 px-1.5 text-[0.625rem] font-semibold tracking-wide text-sidebar-foreground/70 uppercase"
          >
            {t("planned")}
          </span>
        </AccordionMenuItem>
      );
    }

    const active = isActive(item);
    return (
      <AccordionMenuItem key={item.key} value={item.key} asChild>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            setOpenMobile(false);
          }}
        >
          {/* aria-hidden and no label of its own: the accessible name of this link must
              be exactly the module's name. */}
          <Icon aria-hidden="true" />
          <span>{label}</span>
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
