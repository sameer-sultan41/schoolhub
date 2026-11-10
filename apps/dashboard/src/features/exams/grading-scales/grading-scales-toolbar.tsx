"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { GradingScaleFormDialog } from "./grading-scale-form-dialog";

/** Title and "New grading scale" (`exams.grading-scale.create`). Fails closed: disabled, with a
 * `title` saying why, until the viewer's permissions are known. */
export function GradingScalesToolbar() {
  const [addOpen, setAddOpen] = useState(false);
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");

  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const permissionsKnown = currentUser !== undefined;
  const canCreate = hasPermission(currentUser, "exams.grading-scale.create");
  const permissionsUnknownTitle = permissionsKnown
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("gradingScales.title")} description={t("gradingScales.summary")} />
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
                {t("gradingScales.actions.create")}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {addOpen && <GradingScaleFormDialog open onOpenChange={setAddOpen} />}
    </>
  );
}
