"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useAcademicSession } from "@/features/academics/use-academic-session";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { CreatePromotionBatchDialog } from "./create-promotion-batch-dialog";

/**
 * Title and "New batch" (`academics.promotion.create`). The dialog needs the sessions, so the
 * button waits for them and for the viewer's permissions.
 */
export function PromotionBatchToolbar() {
  const [createOpen, setCreateOpen] = useState(false);
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");

  const { sessions, session, isError: isSessionsError } = useAcademicSession("");
  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const permissionsKnown = currentUser !== undefined;
  const canCreate = hasPermission(currentUser, "academics.promotion.create");

  // Fail closed, as the other toolbars do: disabled until the permissions are known, with a
  // `title` saying why. The API enforces regardless.
  const permissionsUnknownTitle = permissionsKnown
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");
  // The dialog is built from the sessions, so with none loaded the button says why and stays off.
  const sessionsFailedTitle = isSessionsError ? t("promotions.list.sessionsFailed") : undefined;
  const showActions = !permissionsKnown || canCreate;
  const actionsDisabled = !permissionsKnown || sessions === undefined;

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("promotions.title")} description={t("promotions.summary")} />
        {showActions && (
          <ToolbarActions>
            {/* On a wrapping `<span>`, not the `Button`: a disabled button never receives
                the hover that shows its own `title`. */}
            <span title={permissionsUnknownTitle ?? sessionsFailedTitle}>
              <Button
                variant="primary"
                disabled={actionsDisabled}
                onClick={() => {
                  setCreateOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("promotions.actions.create")}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {createOpen && sessions && (
        <CreatePromotionBatchDialog
          open
          onOpenChange={setCreateOpen}
          sessions={sessions}
          currentSessionId={session?.id ?? ""}
        />
      )}
    </>
  );
}
