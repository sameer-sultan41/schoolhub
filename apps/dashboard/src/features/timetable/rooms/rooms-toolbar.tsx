"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { RoomFormDialog } from "./room-form-dialog";

/** Title and "Add room" (`timetable.room.create`). Fails closed: disabled, with a `title`
 * saying why, until the viewer's permissions are known. */
export function RoomsToolbar() {
  const [addOpen, setAddOpen] = useState(false);
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");

  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const permissionsKnown = currentUser !== undefined;
  const canCreate = hasPermission(currentUser, "timetable.room.create");
  const permissionsUnknownTitle = permissionsKnown
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("rooms.title")} description={t("rooms.summary")} />
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
                {t("rooms.actions.create")}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {addOpen && <RoomFormDialog open onOpenChange={setAddOpen} />}
    </>
  );
}
