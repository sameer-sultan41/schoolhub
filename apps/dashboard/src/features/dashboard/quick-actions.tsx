"use client";

import type { PermissionKey } from "@schoolhub/types";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@schoolhub/ui";
import {
  CalendarPlus,
  ClipboardCheck,
  type LucideIcon,
  Upload,
  UserPlus,
  UserRoundPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Can } from "@/components/can";
import { useSession } from "@/hooks/use-session";
import { hasAnyPermission } from "@/lib/permissions";

type ActionKey =
  "newStudent" | "newStaff" | "importStudents" | "buildTimetable" | "reviewPromotions";

interface QuickAction {
  key: ActionKey;
  href: string;
  /** The key that lets the reader finish the action, not merely open the screen. */
  permission: PermissionKey;
  icon: LucideIcon;
}

const ACTIONS: QuickAction[] = [
  {
    key: "newStudent",
    href: "/students/new",
    permission: "students.student.create",
    icon: UserPlus,
  },
  { key: "newStaff", href: "/staff/new", permission: "staff.staff.create", icon: UserRoundPlus },
  {
    key: "importStudents",
    href: "/students/import",
    permission: "students.student.import",
    icon: Upload,
  },
  // The week grid is where a timetable is actually built, and `timetable.slot.create` is
  // what makes it more than a read-only view of someone else's work.
  {
    key: "buildTimetable",
    href: "/timetable",
    permission: "timetable.slot.create",
    icon: CalendarPlus,
  },
  {
    key: "reviewPromotions",
    href: "/academics/promotions",
    permission: "academics.promotion.view",
    icon: ClipboardCheck,
  },
];

/**
 * The five things people come to this app to start.
 *
 * Plain labelled buttons, and no `→` appended to any of them: an arrow glyph inside a
 * label is read out by a screen reader, does not mirror under `ur`, and says nothing a
 * link does not already say.
 *
 * The card disappears entirely when a reader can do none of these — an empty "Quick
 * actions" panel is worse than no panel, because it reads as something broken rather
 * than as something that does not apply.
 */
export function QuickActions() {
  const t = useTranslations("dashboard");
  const { user } = useSession();

  if (
    !hasAnyPermission(
      user,
      ACTIONS.map((action) => action.permission),
    )
  )
    return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("actions.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => (
          <Can key={action.key} permission={action.permission}>
            <Button asChild variant="outline">
              <Link href={action.href}>
                <action.icon aria-hidden="true" className="size-4" />
                {t(`actions.${action.key}`)}
              </Link>
            </Button>
          </Can>
        ))}
      </CardContent>
    </Card>
  );
}
