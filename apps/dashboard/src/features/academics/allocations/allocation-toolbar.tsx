"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useAcademicSession } from "@/features/academics/use-academic-session";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useUrlParams } from "@/hooks/use-url-params";
import { hasPermission } from "@/lib/permissions";
import { ALLOCATION_SESSION_PARAM } from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import { AllocateTeacherDialog } from "./allocate-teacher-dialog";

/**
 * Title and "Allocate a teacher" (`.create`, hidden for a locked session). It reads only the
 * `session` URL value: a second `useDataGridUrlState` would fork the table's search state.
 */
export function AllocationToolbar() {
  const [allocateOpen, setAllocateOpen] = useState(false);
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");

  const { searchParams } = useUrlParams();
  const { session, isLocked, isLoading } = useAcademicSession(
    searchParams.get(ALLOCATION_SESSION_PARAM) ?? "",
  );
  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const permissionsKnown = currentUser !== undefined;
  const canCreate = hasPermission(currentUser, "academics.teacher-allocation.create");

  // Fail closed, as the other toolbars do: disabled until the permissions are known, with a
  // `title` saying why. The API enforces regardless.
  const permissionsUnknownTitle = permissionsKnown
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");
  const showActions = !isLocked && (!permissionsKnown || canCreate);
  const actionsDisabled = !permissionsKnown || isLoading || session === null;

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("allocations.title")} description={t("allocations.summary")} />
        {showActions && (
          <ToolbarActions>
            {/* On a wrapping `<span>`, not the `Button`: a disabled button never receives
                the hover that shows its own `title`. */}
            <span title={permissionsUnknownTitle}>
              <Button
                variant="primary"
                disabled={actionsDisabled}
                onClick={() => {
                  setAllocateOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("allocations.actions.create")}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {allocateOpen && session && (
        <AllocateTeacherDialog open onOpenChange={setAllocateOpen} sessionId={session.id} />
      )}
    </>
  );
}
