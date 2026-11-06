"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";

import type { PortalChild } from "@/services";
import { switchChildPath } from "./portal-nav-items";

export interface ChildSwitcherProps {
  /** The summary's children, and only those. */
  kids: readonly PortalChild[];
  selectedStudentId: string | undefined;
}

/** Picks which child the portal shows, by navigating between `[studentId]` segments. Not
 * rendered for a single child (a student, or a guardian of one): there is nothing to switch. */
export function ChildSwitcher({ kids, selectedStudentId }: ChildSwitcherProps) {
  const t = useTranslations("portal.switcher");
  const router = useRouter();
  const pathname = usePathname();

  if (kids.length < 2) return null;

  return (
    <Select
      value={selectedStudentId ?? ""}
      onValueChange={(next) => {
        router.push(switchChildPath(pathname, selectedStudentId, next));
      }}
    >
      <SelectTrigger className="w-full sm:w-64" aria-label={t("label")}>
        <SelectValue placeholder={t("placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {kids.map(({ student }) => (
          <SelectItem key={student.id} value={student.id}>
            {`${student.first_name} ${student.last_name}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
