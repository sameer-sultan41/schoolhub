"use client";

import type { PermissionKey } from "@schoolhub/types";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Can } from "@/components/can";

const LINKS: {
  key: "curriculum" | "allocations" | "promotions";
  href: string;
  permission: PermissionKey;
}[] = [
  { key: "curriculum", href: "/academics", permission: "academics.curriculum.view" },
  {
    key: "allocations",
    href: "/academics/allocations",
    permission: "academics.teacher-allocation.view",
  },
  { key: "promotions", href: "/academics/promotions", permission: "academics.promotion.view" },
];

/**
 * Sub-navigation across the module's three surfaces. Lives in the feature layer
 * rather than the page chrome because it is client state (the active link comes
 * from `usePathname`) and permission-aware — a teacher with only
 * `academics.teacher-allocation.view` never sees the promotion tab.
 *
 * Hiding a link is UX, never security: every one of these screens is enforced
 * server-side by the same key.
 */
export function AcademicsNav() {
  const t = useTranslations("academics");
  const pathname = usePathname();

  return (
    <nav aria-label={t("nav.label")} className="flex flex-wrap gap-1 border-b border-border">
      {LINKS.map((link) => {
        // `/academics` is a prefix of the other two, so only it is matched exactly.
        const isActive =
          link.href === "/academics" ? pathname === link.href : pathname.startsWith(link.href);

        return (
          <Can key={link.key} permission={link.permission}>
            <Link
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={`-mb-px rounded-t-[var(--sh-radius)] border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`nav.${link.key}`)}
            </Link>
          </Can>
        );
      })}
    </nav>
  );
}
