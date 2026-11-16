"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import type { PermissionKey } from "@schoolhub/types";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";

export interface ContentToolbarProps {
  title: string;
  description: string;
  createLabel: string;
  /** The key that offers the create button (`website.news-post.create`, …). */
  createPermission: PermissionKey;
  /** The create dialog, mounted only while open. */
  renderCreateDialog: (onOpenChange: (open: boolean) => void) => ReactNode;
}

/**
 * A content section's heading and its create button. Fails closed: the button is disabled, with
 * a `title` saying why, until the viewer's permissions are known, and hidden without the key.
 */
export function ContentToolbar({
  title,
  description,
  createLabel,
  createPermission,
  renderCreateDialog,
}: ContentToolbarProps) {
  const tCommon = useTranslations("common");
  const [createOpen, setCreateOpen] = useState(false);
  const { data: user, isError } = useCurrentUser();
  const permissionsKnown = user !== undefined;
  const canCreate = hasPermission(user, createPermission);
  const unknownTitle = permissionsKnown
    ? undefined
    : isError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={title} description={description} />
        {(!permissionsKnown || canCreate) && (
          <ToolbarActions>
            {/* On a wrapping `<span>`: a disabled button never shows its own `title`. */}
            <span title={unknownTitle}>
              <Button
                variant="primary"
                disabled={!permissionsKnown}
                onClick={() => {
                  setCreateOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                {createLabel}
              </Button>
            </span>
          </ToolbarActions>
        )}
      </Toolbar>
      {createOpen && renderCreateDialog(setCreateOpen)}
    </>
  );
}
