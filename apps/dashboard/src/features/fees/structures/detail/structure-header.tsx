"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Archive, ArrowLeft, CircleCheck, Pencil, Trash2 } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { EMPTY_VALUE } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import type { FeeStructureRecord } from "@/services";
import { isStructureEditable } from "@/services/modules/fee-structures/fee-structures-helper";
import { StructureStatusBadge } from "@/features/fees/shared/structure-status-badge";
import { useStructureReferences } from "@/features/fees/shared/use-structure-references";
import { StructureFormDialog } from "@/features/fees/structures/structure-form-dialog";
import { DeleteStructureDialog } from "./delete-structure-dialog";
import {
  StructureLifecycleDialog,
  type StructureLifecycleAction,
} from "./structure-lifecycle-dialog";

type OpenDialog = "edit" | "delete" | StructureLifecycleAction | null;

/**
 * The structure's name, scope and status, and what the viewer may do with it, each on its key and
 * the structure's own state: Activate (a draft) and Archive (an active one) follow
 * `fees.fee-structure.update`, as does Edit (a draft); Delete (a draft) follows `.delete`. An
 * active or archived structure is fixed, so it offers no edit. Each dialog is mounted only while
 * open.
 */
export function StructureHeader({ structure }: { structure: FeeStructureRecord }) {
  const t = useTranslations("fees");
  const router = useRouter();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const { names } = useStructureReferences();

  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, "fees.fee-structure.update");
  const canDelete = hasPermission(user, "fees.fee-structure.delete");
  const isDraft = isStructureEditable(structure);
  const isActive = structure.status === "active";

  return (
    <>
      <Toolbar>
        <ToolbarHeading
          title={structure.name}
          description={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-medium text-foreground">
                {names.sessions.get(structure.academic_session) ?? EMPTY_VALUE}
              </span>
              <span>
                {structure.school_class
                  ? (names.classes.get(structure.school_class) ?? EMPTY_VALUE)
                  : t("structures.everyClass")}
              </span>
              <span>
                {structure.campus
                  ? (names.campuses.get(structure.campus) ?? EMPTY_VALUE)
                  : t("structures.everyCampus")}
              </span>
              <StructureStatusBadge status={structure.status} />
            </div>
          }
        />
        <ToolbarActions>
          <Button variant="outline" asChild>
            <Link href={Paths.FEES_STRUCTURES}>
              <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
              {t("structures.actions.backToList")}
            </Link>
          </Button>
          {canUpdate && isDraft && (
            <Button
              variant="outline"
              onClick={() => {
                setDialog("edit");
              }}
            >
              <Pencil aria-hidden="true" />
              {t("structures.actions.edit")}
            </Button>
          )}
          {canDelete && isDraft && (
            <Button
              variant="destructive"
              appearance="light"
              onClick={() => {
                setDialog("delete");
              }}
            >
              <Trash2 aria-hidden="true" />
              {t("structures.actions.delete")}
            </Button>
          )}
          {canUpdate && isActive && (
            <Button
              variant="outline"
              onClick={() => {
                setDialog("archive");
              }}
            >
              <Archive aria-hidden="true" />
              {t("structures.actions.archive")}
            </Button>
          )}
          {canUpdate && isDraft && (
            <Button
              variant="primary"
              onClick={() => {
                setDialog("activate");
              }}
            >
              <CircleCheck aria-hidden="true" />
              {t("structures.actions.activate")}
            </Button>
          )}
        </ToolbarActions>
      </Toolbar>
      {dialog === "edit" && <StructureFormDialog open onOpenChange={close} record={structure} />}
      {dialog === "delete" && (
        <DeleteStructureDialog
          open
          onOpenChange={close}
          record={structure}
          onDeleted={() => {
            router.push(Paths.FEES_STRUCTURES);
          }}
        />
      )}
      {(dialog === "activate" || dialog === "archive") && (
        <StructureLifecycleDialog open onOpenChange={close} action={dialog} structure={structure} />
      )}
    </>
  );
}
