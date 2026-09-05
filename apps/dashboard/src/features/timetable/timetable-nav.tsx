"use client";

import type { PermissionKey } from "@schoolhub/types";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Can } from "@/components/can";

const LINKS: {
  key: "grid" | "periods" | "rooms" | "substitutions" | "my";
  href: string;
  permission: PermissionKey;
}[] = [
  // The builder's grid shows drafts, so it is gated on the narrow key, not on
  // `timetable.timetable.view` which every role including students holds.
  { key: "grid", href: "/timetable", permission: "timetable.slot.view" },
  { key: "periods", href: "/timetable/periods", permission: "timetable.period.update" },
  { key: "rooms", href: "/timetable/rooms", permission: "timetable.room.update" },
  {
    key: "substitutions",
    href: "/timetable/substitutions",
    permission: "timetable.substitution.create",
  },
  { key: "my", href: "/timetable/my", permission: "timetable.timetable.view" },
];

/**
 * Sub-navigation across the module's surfaces, mirroring AcademicsNav.
 *
 * Lives in the feature layer rather than the page chrome because it is client
 * state (the active link comes from `usePathname`) and permission-aware — a
 * student holding only `timetable.timetable.view` sees the "My timetable" tab
 * and nothing else, which is exactly §5.7's "unpublished edits never leak".
 *
 * Hiding a link is UX, never security: every one of these screens is enforced
 * server-side by the same key.
 */
export function TimetableNav() {
  const t = useTranslations("timetable");
  const pathname = usePathname();

  return (
    <nav aria-label={t("nav.label")} className="flex flex-wrap gap-1 border-b border-border">
      {LINKS.map((link) => {
        // `/timetable` is a prefix of every other href, so only it is matched exactly.
        const isActive =
          link.href === "/timetable" ? pathname === link.href : pathname.startsWith(link.href);

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
