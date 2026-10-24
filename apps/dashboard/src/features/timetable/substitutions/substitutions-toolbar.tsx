"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useAcademicSession } from "@/components/academic-session/use-academic-session";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { ProposeSubstitutionDialog } from "./propose-substitution-dialog";

/** Title and "Propose a substitution" (`timetable.substitution.create`), which covers the
 * current session's published classes. Fails closed until the permissions are known. */
export function SubstitutionsToolbar() {
  const [proposing, setProposing] = useState(false);
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const { session } = useAcademicSession("");

  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const permissionsKnown = currentUser !== undefined;
  const canCreate = hasPermission(currentUser, "timetable.substitution.create");
  const permissionsUnknownTitle = permissionsKnown
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("substitutions.title")} description={t("substitutions.summary")} />
        {(!permissionsKnown || canCreate) && (
          <ToolbarActions>
            {/* On a wrapping `<span>`: a disabled button never shows its own `title`. */}
            <span title={permissionsUnknownTitle}>
              <Button
                variant="primary"
                disabled={!permissionsKnown || session === null}
                onClick={() => {
                  setProposing(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("substitutions.actions.create")}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {proposing && session && (
        <ProposeSubstitutionDialog
          open
          onOpenChange={setProposing}
          academicSessionId={session.id}
        />
      )}
    </>
  );
}
