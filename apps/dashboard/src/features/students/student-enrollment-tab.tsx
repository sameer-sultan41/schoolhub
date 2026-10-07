"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton } from "@schoolhub/ui";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { StudentHistoryEvent } from "@/services/modules/students/students-type";
import type { StudentTransferRecord } from "@/services/modules/student-transfers/student-transfers-type";
import { ChangeSectionDialog } from "./change-section-dialog";
import { CompleteTransferDialog } from "./complete-transfer-dialog";
import { EnrollDialog } from "./enroll-dialog";
import { RequestTransferDialog } from "./request-transfer-dialog";
import { TransferDecisionDialog } from "./transfer-decision-dialog";

export interface StudentEnrollmentTabPermissions {
  /** `students.enrollment.enroll`. */
  canEnroll: boolean;
  /** `students.enrollment.update`. */
  canChangeSection: boolean;
  /** `students.student.update` — gates the capacity-override field on enroll/
   * change-section, a different key than either action's own permission. */
  canOverrideCapacity: boolean;
  /** `students.transfer.create`. */
  canRequestTransfer: boolean;
  /** `students.transfer.approve`. */
  canDecide: boolean;
  /** `students.transfer.create` — `complete` reuses the create key, confirmed from the
   * real view's `required_permission_map` (an operational step for the requesting role,
   * not a second decision). */
  canComplete: boolean;
}

export interface StudentEnrollmentTabProps {
  studentId: string;
  campusId: string;
  permissions: StudentEnrollmentTabPermissions;
}

function isEnrollmentEvent(
  event: StudentHistoryEvent,
): event is Extract<StudentHistoryEvent, { type: "enrollment" }> {
  return event.type === "enrollment";
}

type DialogState =
  | { kind: "enroll" }
  | { kind: "changeSection" }
  | { kind: "requestTransfer" }
  | { kind: "decision"; transferId: string; decision: "approve" | "reject" }
  | { kind: "complete"; transfer: StudentTransferRecord }
  | null;

export function StudentEnrollmentTab({
  studentId,
  campusId,
  permissions,
}: StudentEnrollmentTabProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const [dialog, setDialog] = useState<DialogState>(null);

  const historyQuery = useQuery({
    queryKey: queryKeys.list("students", "history", { studentId }),
    queryFn: () => Services.students.fetchStudentHistory(studentId),
  });

  const transfersQuery = useQuery({
    queryKey: queryKeys.list("student-transfers", "transfers", { studentId }),
    queryFn: () => Services.studentTransfers.fetchStudentTransfers(studentId),
  });

  const campusesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
  });
  const campusName = (id: string | null | undefined) =>
    (campusesQuery.data ?? []).find((campus) => campus.id === id)?.name ?? id ?? "";

  const currentEnrollment = useMemo(() => {
    const active = (historyQuery.data ?? [])
      .filter(isEnrollmentEvent)
      .filter((event) => event.status === "active");
    if (active.length === 0) return null;
    // Defensive tie-break only — `active_enrollment()` (services.py) assumes at most one
    // active row; this never relies on the server actually returning two.
    return active.reduce((latest, event) => (event.date > latest.date ? event : latest));
  }, [historyQuery.data]);

  const currentEnrollmentClass = currentEnrollment
    ? { id: currentEnrollment.class_id, name: currentEnrollment.class_name }
    : null;

  if (historyQuery.isPending) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (historyQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("detail.loadError")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void historyQuery.refetch();
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{t("enrollment.title")}</h3>
          {currentEnrollment
            ? permissions.canChangeSection && (
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog({ kind: "changeSection" });
                  }}
                >
                  {t("enrollment.changeSection")}
                </Button>
              )
            : permissions.canEnroll && (
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog({ kind: "enroll" });
                  }}
                >
                  {t("enrollment.enroll")}
                </Button>
              )}
        </div>
        {currentEnrollment ? (
          <div className="space-y-1 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">
              {currentEnrollment.academic_session_name} — {currentEnrollment.class_name}{" "}
              {currentEnrollment.section_name}
            </p>
            {currentEnrollment.roll_number ? (
              <p className="text-xs text-muted-foreground">
                {t("enrollment.rollNumber", { roll: currentEnrollment.roll_number })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("enrollment.notEnrolled")}</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{t("transfers.title")}</h3>
          {currentEnrollment && permissions.canRequestTransfer && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDialog({ kind: "requestTransfer" });
              }}
            >
              {t("transfers.request")}
            </Button>
          )}
        </div>
        {transfersQuery.isError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{t("transfers.loadError")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void transfersQuery.refetch();
              }}
            >
              {tCommon("retry")}
            </Button>
          </div>
        ) : transfersQuery.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : transfersQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("transfers.empty")}</p>
        ) : (
          <div className="space-y-3">
            {transfersQuery.data.map((transfer) => (
              <div key={transfer.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {t(`transfers.type.${transfer.transfer_type}`)}
                  </p>
                  <Badge variant="outline">{t(`transfers.status.${transfer.status}`)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {campusName(transfer.from_campus_id)}
                  {transfer.to_campus_id ? ` → ${campusName(transfer.to_campus_id)}` : ""}
                  {transfer.external_school_name ? ` → ${transfer.external_school_name}` : ""}
                </p>
                <div className="flex gap-2">
                  {transfer.status === "requested" && permissions.canDecide && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => {
                          setDialog({
                            kind: "decision",
                            transferId: transfer.id,
                            decision: "approve",
                          });
                        }}
                      >
                        {t("transfers.approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setDialog({
                            kind: "decision",
                            transferId: transfer.id,
                            decision: "reject",
                          });
                        }}
                      >
                        {t("transfers.reject")}
                      </Button>
                    </>
                  )}
                  {transfer.status === "approved" &&
                    permissions.canComplete &&
                    transfer.transfer_type !== "incoming" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setDialog({ kind: "complete", transfer });
                        }}
                      >
                        {t("transfers.complete")}
                      </Button>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t("history.timelineTitle")}</h3>
        {historyQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {[...historyQuery.data].reverse().map((event) => (
              <li key={`${event.type}-${event.id}`} className="text-xs text-muted-foreground">
                {event.type === "enrollment"
                  ? t("history.event.enrollment", {
                      session: event.academic_session_name,
                      className: event.class_name,
                      section: event.section_name,
                    })
                  : t("history.event.transfer", {
                      type: t(`transfers.type.${event.transfer_type}`),
                    })}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.kind === "enroll" && (
        <EnrollDialog
          studentId={studentId}
          campusId={campusId}
          canOverrideCapacity={permissions.canOverrideCapacity}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "changeSection" && currentEnrollmentClass && (
        <ChangeSectionDialog
          studentId={studentId}
          campusId={campusId}
          currentClass={currentEnrollmentClass}
          canOverrideCapacity={permissions.canOverrideCapacity}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "requestTransfer" && (
        <RequestTransferDialog
          studentId={studentId}
          currentCampusId={campusId}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "decision" && (
        <TransferDecisionDialog
          transferId={dialog.transferId}
          studentId={studentId}
          decision={dialog.decision}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "complete" && (
        <CompleteTransferDialog
          transfer={dialog.transfer}
          currentEnrollmentClass={currentEnrollmentClass}
          canComplete={permissions.canComplete}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
    </div>
  );
}
