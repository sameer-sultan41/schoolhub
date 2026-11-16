"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { PageFormDialog } from "./page-form-dialog";

/** Title and "New page" (`website.page.create`). Fails closed: disabled, with a `title` saying
 * why, until the viewer's permissions are known. */
export function PagesToolbar() {
  const [addOpen, setAddOpen] = useState(false);
  const t = useTranslations("website.pages");
  const tCommon = useTranslations("common");

  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const permissionsKnown = currentUser !== undefined;
  const canCreate = hasPermission(currentUser, "website.page.create");
  const permissionsUnknownTitle = permissionsKnown
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("title")} description={t("summary")} />
        {(!permissionsKnown || canCreate) && (
          <ToolbarActions>
            {/* On a wrapping `<span>`: a disabled button never shows its own `title`. */}
            <span title={permissionsUnknownTitle}>
              <Button
                variant="primary"
                disabled={!permissionsKnown}
                onClick={() => {
                  setAddOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("actions.create")}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {addOpen && <PageFormDialog open onOpenChange={setAddOpen} />}
    </>
  );
}
