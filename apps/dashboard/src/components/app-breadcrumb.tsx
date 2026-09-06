"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav-items";

/**
 * Sub-route segment → the message key that names it.
 *
 * Deliberately reuses each module's existing nav strings (`timetable.nav.rooms`,
 * `academics.nav.promotions`, …) rather than minting breadcrumb-only copies: the crumb and
 * the screen it leads to must read the same, and two keys is how they drift apart. Only the
 * three verbs shared by every module (`new`, `edit`, `import`) live under `common`.
 */
const SEGMENT_KEYS: Record<string, string> = {
  new: "common.new",
  edit: "common.edit",
  import: "common.import",
  my: "timetable.nav.my",
  periods: "timetable.nav.periods",
  rooms: "timetable.nav.rooms",
  substitutions: "timetable.nav.substitutions",
  allocations: "academics.nav.allocations",
  promotions: "academics.nav.promotions",
};

/**
 * Where you are, derived from the URL rather than declared per route: a page that forgets
 * to pass its own trail is exactly the page a user gets lost on.
 *
 * Renders nothing at the top level of a module (`/students`) — the sidebar already marks
 * that entry as the current page, and a one-item breadcrumb is chrome that says nothing.
 * Only the module crumb is a link: every other segment either has no standalone route
 * (`/students/new`'s parent is the module) or is a record id whose own page is the next
 * crumb along, so linking them would manufacture 404s of exactly the kind the `planned`
 * nav entries exist to avoid.
 */
export function AppBreadcrumb() {
  const t = useTranslations();
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  // `status === "ready"` as well as the href: a module still marked planned has no route
  // today, but the moment a stub page appears under one this would render a live link to
  // it — ahead of the sidebar, which still shows the same module disabled with a "Soon"
  // badge. One of the two would be lying about whether the module is usable.
  const moduleItem = NAV_ITEMS.find(
    (item) => item.href === `/${segments[0] ?? ""}` && item.status === "ready",
  );

  // A single segment is the module's own landing page; an unknown first segment is a route
  // that no nav entry claims, and inventing a label for it would be a guess.
  if (segments.length < 2 || !moduleItem) return null;

  const crumbs = segments.slice(1).map((segment, index) => {
    const messageKey = SEGMENT_KEYS[segment];
    return {
      key: `${segment}-${index}`,
      // Anything unrecognised is an id (a student, a promotion batch). "Details" is honest
      // where a raw UUID would be noise.
      label: messageKey ? t(messageKey) : t("common.details"),
    };
  });

  return (
    <nav aria-label={t("nav.breadcrumb")} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <li className="flex min-w-0 items-center">
          <Link href={moduleItem.href} className="truncate transition-colors hover:text-foreground">
            {t(`nav.${moduleItem.key}`)}
          </Link>
        </li>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.key} className="flex min-w-0 items-center gap-1.5">
              {/* Mirrored under `ur`: a chevron that keeps pointing right in an RTL
                  document points back the way the reader came from. */}
              <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 rtl:scale-x-[-1]" />
              <span
                className={isLast ? "truncate font-medium text-foreground" : "truncate"}
                aria-current={isLast ? "page" : undefined}
              >
                {crumb.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
