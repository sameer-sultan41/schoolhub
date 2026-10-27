"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Upload } from "lucide-react";

import { SessionPicker } from "@/components/academic-session/session-picker";
import { useAcademicSession } from "@/components/academic-session/use-academic-session";
import { BulkImportDialog } from "@/components/bulk-import-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services } from "@/services";
import {
  ATTENDANCE_IMPORT_JOB_STORAGE_PREFIX,
  ATTENDANCE_IMPORT_OPTIONAL_COLUMNS,
  ATTENDANCE_IMPORT_REQUIRED_COLUMNS,
  STUDENT_ATTENDANCE_QUERY_MODULE,
} from "@/services/modules/student-attendance/student-attendance-constant";

/**
 * The Records toolbar's Import, for a holder of `attendance.student-attendance.import` (an
 * `it_admin` migrating a previous system's history, §9). No one else sees it, and nothing of it is
 * requested for them: the sessions are read only behind the key.
 */
export function ImportAttendanceButton() {
  const { data: currentUser } = useCurrentUser();
  if (!hasPermission(currentUser, "attendance.student-attendance.import")) return null;
  return <ImportAttendance />;
}

/**
 * The button and its dialog. The import is filed under the session picked in the dialog: the
 * current one when there is one, and any session otherwise (an onboarding tenant may have only
 * past ones). The API never defaults it, since history usually belongs to a past session.
 */
function ImportAttendance() {
  const t = useTranslations("attendance");
  const [open, setOpen] = useState(false);
  // `""` is "the current session", as the picker reports it.
  const [pickedSessionId, setPickedSessionId] = useState("");
  const { sessions, session } = useAcademicSession(pickedSessionId);
  const sessionId = session?.id ?? "";

  return (
    <>
      <Button
        variant="outline"
        // Nothing to file the rows under: the sessions are loading, failed, or none exist.
        disabled={sessions === undefined || sessions.length === 0}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Upload aria-hidden="true" />
        {t("records.import.button")}
      </Button>
      <BulkImportDialog
        open={open}
        onOpenChange={setOpen}
        module={STUDENT_ATTENDANCE_QUERY_MODULE}
        title={t("records.import.title")}
        description={t("records.import.description")}
        requiredColumns={ATTENDANCE_IMPORT_REQUIRED_COLUMNS}
        optionalColumns={ATTENDANCE_IMPORT_OPTIONAL_COLUMNS}
        storageKeyPrefix={ATTENDANCE_IMPORT_JOB_STORAGE_PREFIX}
        start={(file) => Services.studentAttendance.triggerAttendanceImport(file, sessionId)}
        canUpload={sessionId !== ""}
        renderFields={(disabled) => (
          <div className="space-y-1.5">
            <SessionPicker
              sessions={sessions}
              value={sessionId}
              onChange={setPickedSessionId}
              disabled={disabled}
              className="w-full"
            />
            <p className="text-sm text-muted-foreground">{t("records.import.sessionHint")}</p>
          </div>
        )}
      />
    </>
  );
}
