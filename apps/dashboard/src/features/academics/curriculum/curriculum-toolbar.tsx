"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { CopyPlus, Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useAcademicSession } from "@/components/academic-session/use-academic-session";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useUrlParams } from "@/hooks/use-url-params";
import { LIST_URL_KEYS } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { CURRICULUM_SESSION_PARAM } from "@/services/modules/curriculum/curriculum-constant";
import { CloneCurriculumDialog } from "./clone-curriculum-dialog";
import { CurriculumFormDialog } from "./curriculum-form-dialog";

/**
 * The `/academics/curriculum` toolbar: title, "Add subject" and "Clone from another session".
 * Both actions need `academics.curriculum.create`, wait for the viewer's permissions and the
 * session, and are hidden for a locked (closed or archived) session.
 *
 * It reads only the `session` URL value, through `useUrlParams`: a second
 * `useDataGridUrlState` would keep its own search state, forked from the table's.
 */
export function CurriculumToolbar() {
  const [addOpen, setAddOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");

  const { searchParams, setParams } = useUrlParams();
  const { sessions, session, isLocked, isLoading } = useAcademicSession(
    searchParams.get(CURRICULUM_SESSION_PARAM) ?? "",
  );
  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const permissionsKnown = currentUser !== undefined;
  const canCreate = hasPermission(currentUser, "academics.curriculum.create");

  // Fail closed, as the other toolbars do: disabled until the permissions are known, with a
  // `title` saying why. The API enforces regardless.
  const permissionsUnknownTitle = permissionsKnown
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");
  const showActions = !isLocked && (!permissionsKnown || canCreate);
  const actionsDisabled = !permissionsKnown || isLoading || session === null;

  // Cloning into a session the screen isn't showing moves the screen there; the current
  // session is the URL's default, so it is the absence of the key.
  function switchSession(sessionId: string) {
    const target = sessions?.find((candidate) => candidate.id === sessionId);
    setParams({
      [CURRICULUM_SESSION_PARAM]: target?.is_current ? null : sessionId,
      [LIST_URL_KEYS.page]: null,
    });
  }

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("curriculum.title")} description={t("curriculum.summary")} />
        {showActions && (
          <ToolbarActions>
            {/* On a wrapping `<span>`, not the `Button`: a disabled button never receives
                the hover that shows its own `title`. */}
            <span title={permissionsUnknownTitle}>
              <Button
                variant="outline"
                disabled={actionsDisabled}
                onClick={() => {
                  setCloneOpen(true);
                }}
              >
                <CopyPlus aria-hidden="true" />
                {t("curriculum.actions.clone")}
              </Button>
            </span>
            <span title={permissionsUnknownTitle}>
              <Button
                variant="primary"
                disabled={actionsDisabled}
                onClick={() => {
                  setAddOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("curriculum.actions.create")}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {addOpen && session && (
        <CurriculumFormDialog
          open
          onOpenChange={setAddOpen}
          sessions={sessions ?? []}
          sessionId={session.id}
        />
      )}
      {cloneOpen && session && (
        <CloneCurriculumDialog
          open
          onOpenChange={setCloneOpen}
          sessions={sessions ?? []}
          currentSessionId={session.id}
          onSwitchSession={switchSession}
        />
      )}
    </>
  );
}
