"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { useCurrentUser } from "@/hooks/use-current-user";
import { permittedSections, type ModuleSection } from "./module-sections";

const TAB_CLASS =
  "inline-flex items-center whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:text-foreground";

export interface ModuleSectionNavProps {
  sections: readonly ModuleSection[];
  /** The module's message namespace (`academics`, `timetable`): it holds `nav.label` and
   * every section's `labelKey`. */
  namespace: string;
}

/** A module's sections as link tabs, one per section the viewer may open. Hidden entirely
 * when there are none (or while the viewer's permissions load). */
export function ModuleSectionNav({ sections, namespace }: ModuleSectionNavProps) {
  const t = useTranslations(namespace);
  const pathname = usePathname();
  const { data: user } = useCurrentUser();
  const permitted = permittedSections(sections, user);

  if (permitted.length === 0) return null;

  return (
    <nav aria-label={t("nav.label")} className="mb-5 border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {permitted.map((section) => {
          const isCurrent = pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={isCurrent ? "page" : undefined}
                className={TAB_CLASS}
              >
                {t(section.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
