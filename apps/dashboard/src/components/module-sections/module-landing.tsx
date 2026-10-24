"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@schoolhub/ui";

import { useCurrentUser } from "@/hooks/use-current-user";
import { permittedSections, type ModuleSection } from "./module-sections";

/**
 * A module's root (`/academics`, `/timetable`) has no page of its own: it sends the viewer to
 * the first section they may open, so a viewer who can open only a later section never lands
 * on a 403. Client-side because the session (an in-memory token) is invisible to a server
 * `redirect`. Shows a message only when there is nowhere to send them, or while that is
 * still unknown.
 */
export function ModuleLanding({ sections }: { sections: readonly ModuleSection[] }) {
  const router = useRouter();
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: user, isError } = useCurrentUser();
  const href = permittedSections(sections, user)[0]?.href;

  useEffect(() => {
    if (href) router.replace(href);
  }, [href, router]);

  // Redirecting.
  if (href) return null;

  const message = user
    ? tErrors("permission_denied")
    : isError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");

  return (
    <Card>
      <p className="p-6 text-sm text-muted-foreground">{message}</p>
    </Card>
  );
}
