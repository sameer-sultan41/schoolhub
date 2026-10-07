"use client";

import { Pencil, UserMinus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { ResponsiveSheetFooter } from "@/components/responsive-dialog";
import { STUDENT_WITHDRAWABLE_STATUS } from "@/services/modules/students/students-constant";
import type { StudentRow } from "@/services/modules/students/students-type";

/** `StudentDetailSheet`'s footer — extracted to its own file to keep that file under the
 * repo's `max-lines` limit once the Enrollment tab pushed it over. */
export function StudentDetailFooter({
  row,
  canUpdate,
  canWithdraw,
  isDrawer,
  onEdit,
  onWithdraw,
}: {
  row: StudentRow;
  canUpdate: boolean;
  canWithdraw: boolean;
  isDrawer: boolean;
  onEdit: (id: string) => void;
  onWithdraw: (id: string, name: string) => void;
}) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const showWithdraw = canWithdraw && row.status === STUDENT_WITHDRAWABLE_STATUS;

  if (isDrawer) {
    return (
      <ResponsiveSheetFooter className="flex-row justify-end gap-2.5 border-t border-border px-4 py-3">
        {canUpdate && (
          <Button
            variant="outline-primary"
            mode="icon"
            shape="circle"
            aria-label={tCommon("edit")}
            onClick={() => {
              onEdit(row.id);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        )}
        {showWithdraw && (
          <Button
            variant="destructive"
            mode="icon"
            shape="circle"
            aria-label={`${t("actions.withdraw")} ${row.name}`}
            onClick={() => {
              onWithdraw(row.id, row.name);
            }}
          >
            <UserMinus className="size-4" aria-hidden="true" />
          </Button>
        )}
      </ResponsiveSheetFooter>
    );
  }

  return (
    <ResponsiveSheetFooter className="border-t border-border px-6 py-4">
      {canUpdate && (
        <Button
          variant="outline-primary"
          onClick={() => {
            onEdit(row.id);
          }}
        >
          <Pencil className="size-4" aria-hidden="true" /> {tCommon("edit")}
        </Button>
      )}
      {showWithdraw && (
        <Button
          variant="destructive"
          onClick={() => {
            onWithdraw(row.id, row.name);
          }}
        >
          <UserMinus className="size-4" aria-hidden="true" /> {t("actions.withdraw")}
        </Button>
      )}
    </ResponsiveSheetFooter>
  );
}
