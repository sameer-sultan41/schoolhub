"use client";

import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Pencil, UserMinus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, Badge, Button, Skeleton } from "@schoolhub/ui";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetTitle,
  useIsDrawer,
} from "@/components/responsive-dialog";
import { getInitials } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { STUDENT_WITHDRAWABLE_STATUS } from "@/services/modules/students/students-constant";
import { formatLastUpdated } from "@/services/modules/students/students-helper";
import type { StudentRow } from "@/services/modules/students/students-type";

export interface StudentDetailSheetProps {
  row: StudentRow | null;
  canUpdate: boolean;
  canWithdraw: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
  onWithdraw: (id: string, name: string) => void;
}

function FieldRow({
  label,
  value,
  isPending,
}: {
  label: string;
  value?: string | null;
  isPending: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {isPending ? (
        <Skeleton className="h-4 w-24" />
      ) : (
        <span className="text-sm">{value || "—"}</span>
      )}
    </div>
  );
}

export function StudentDetailSheet({
  row,
  canUpdate,
  canWithdraw,
  onOpenChange,
  onEdit,
  onWithdraw,
}: StudentDetailSheetProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  const detailQuery = useQuery({
    queryKey: queryKeys.detail("students", "students", row?.id ?? ""),
    queryFn: () => Services.students.fetchStudentById(row?.id as string),
    enabled: row !== null,
  });
  const data = detailQuery.data;
  // `"medical_notes" in data` — not `data?.medical_notes` / `?? ""` / truthiness — because
  // the backend *omits the key entirely* for a viewer without visibility, but sends it as
  // `null` for a viewer who can see it when the student simply has none on file. Those are
  // two different facts: "you can't see this" vs. "there's nothing to see." A falsy check
  // would conflate both as "Restricted".
  const hasMedicalNotesField = data !== undefined && "medical_notes" in data;

  // Data-driven instead of one <FieldRow> per field: every row shares the same
  // label/value/isPending shape, so the only thing that varies is which piece of `data`
  // (or derived string) feeds it. Grouped by section since that's how the sheet renders
  // its three headings.
  const sections: {
    title: string;
    fields: { label: string; value: string | null | undefined }[];
  }[] = [
    {
      title: t("detail.personal"),
      fields: [
        { label: t("fields.admissionNumber"), value: data?.admission_number },
        { label: t("fields.preferredName"), value: data?.preferred_name },
        { label: t("fields.dateOfBirth"), value: data?.date_of_birth },
        { label: t("fields.gender"), value: data ? t(`gender.${data.gender}`) : undefined },
        { label: t("fields.nationality"), value: data?.nationality },
        { label: t("fields.religion"), value: data?.religion },
      ],
    },
    {
      title: t("detail.academic"),
      fields: [
        { label: t("fields.campus"), value: data?.campus_name },
        { label: t("fields.house"), value: data?.house_name },
        { label: t("fields.admissionDate"), value: data?.admission_date },
        { label: t("fields.previousSchool"), value: data?.previous_school },
      ],
    },
    {
      title: t("detail.medical"),
      fields: [
        { label: t("fields.bloodGroup"), value: data?.blood_group },
        {
          label: t("fields.medicalNotes"),
          value: hasMedicalNotesField ? data.medical_notes : t("fields.medicalNotesRestricted"),
        },
      ],
    },
  ];

  return (
    <ResponsiveSheet open={row !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent closeLabel={tCommon("close")}>
        <ResponsiveSheetTitle className="sr-only">
          {row ? t("detail.title", { name: row.name }) : t("detail.titleFallback")}
        </ResponsiveSheetTitle>
        {row && (
          <>
            <div className="flex items-center gap-3 px-4 pt-4">
              <Avatar className="size-12">
                <AvatarImage src={row.signedPhotoUrl} alt="" />
                <AvatarFallback>{getInitials(row.name)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium">{row.name}</div>
                <div className="text-xs text-muted-foreground">{row.admissionNumber}</div>
                <Badge appearance="light">{t(`status.${row.status}`)}</Badge>
              </div>
            </div>
            <ResponsiveSheetBody>
              {detailQuery.isError ? (
                <p className="text-sm text-muted-foreground">{t("detail.loadError")}</p>
              ) : (
                <div className="space-y-1">
                  {sections.map((section) => (
                    <Fragment key={section.title}>
                      <h3 className="text-sm font-medium">{section.title}</h3>
                      {section.fields.map((field) => (
                        <FieldRow
                          key={field.label}
                          label={field.label}
                          value={field.value}
                          isPending={detailQuery.isPending}
                        />
                      ))}
                    </Fragment>
                  ))}
                  {/* Same loading gate as every FieldRow above: a skeleton until the detail
                      arrives, never "Last updated " with nothing after it. */}
                  {data ? (
                    <p className="text-xs text-muted-foreground">
                      {t("detail.lastUpdated", { when: formatLastUpdated(data.updated_at) })}
                    </p>
                  ) : (
                    <Skeleton className="h-3 w-32" />
                  )}
                </div>
              )}
            </ResponsiveSheetBody>
            <DetailFooter
              row={row}
              canUpdate={canUpdate}
              canWithdraw={canWithdraw}
              onEdit={onEdit}
              onWithdraw={onWithdraw}
            />
          </>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function DetailFooter({
  row,
  canUpdate,
  canWithdraw,
  onEdit,
  onWithdraw,
}: {
  row: StudentRow;
  canUpdate: boolean;
  canWithdraw: boolean;
  onEdit: (id: string) => void;
  onWithdraw: (id: string, name: string) => void;
}) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const isDrawer = useIsDrawer();
  const showWithdraw = canWithdraw && row.status === STUDENT_WITHDRAWABLE_STATUS;

  return (
    <ResponsiveSheetFooter>
      {isDrawer ? (
        <>
          {canUpdate && (
            <Button
              size="icon"
              variant="outline"
              aria-label={tCommon("edit")}
              onClick={() => {
                onEdit(row.id);
              }}
            >
              <Pencil className="size-4" />
            </Button>
          )}
          {showWithdraw && (
            <Button
              size="icon"
              variant="destructive"
              aria-label={`${t("actions.withdraw")} ${row.name}`}
              onClick={() => {
                onWithdraw(row.id, row.name);
              }}
            >
              <UserMinus className="size-4" />
            </Button>
          )}
        </>
      ) : (
        <>
          {canUpdate && (
            <Button
              variant="outline"
              onClick={() => {
                onEdit(row.id);
              }}
            >
              {tCommon("edit")}
            </Button>
          )}
          {showWithdraw && (
            <Button
              variant="destructive"
              onClick={() => {
                onWithdraw(row.id, row.name);
              }}
            >
              {t("actions.withdraw")}
            </Button>
          )}
        </>
      )}
    </ResponsiveSheetFooter>
  );
}
