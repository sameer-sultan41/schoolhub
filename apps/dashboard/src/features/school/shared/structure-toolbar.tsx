"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PermissionKey } from "@schoolhub/types";
import { Button } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";

export interface StructureToolbarProps {
  title: string;
  description: string;
  addLabel: string;
  /** The key the Add button needs. */
  createKey: PermissionKey;
  /** The create dialog, mounted only while open, closing through `onOpenChange(false)`. */
  renderAddDialog: (onOpenChange: (open: boolean) => void) => ReactNode;
}

/** A structure section's title and its Add button. Fails closed: disabled, with a `title`
 * saying why, until the viewer's permissions are known. */
export function StructureToolbar({
  title,
  description,
  addLabel,
  createKey,
  renderAddDialog,
}: StructureToolbarProps) {
  const [addOpen, setAddOpen] = useState(false);
  const tCommon = useTranslations("common");

  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const permissionsKnown = currentUser !== undefined;
  const canCreate = hasPermission(currentUser, createKey);
  const permissionsUnknownTitle = permissionsKnown
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={title} description={description} />
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
                {addLabel}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {addOpen && renderAddDialog(setAddOpen)}
    </>
  );
}
