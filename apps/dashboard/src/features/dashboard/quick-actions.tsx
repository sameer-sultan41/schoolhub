"use client";

import { Button, Card, CardContent, CardHeader, CardTitle } from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Can } from "@/components/can";
import { useSession } from "@/hooks/use-session";
import { hasAnyPermission } from "@/lib/permissions";
import { QUICK_ACTIONS } from "@/lib/quick-actions";

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
      QUICK_ACTIONS.map((action) => action.permission),
    )
  )
    return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("actions.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((action) => (
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
