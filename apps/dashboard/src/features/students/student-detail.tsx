"use client";

import { ApiError } from "@schoolhub/api-client";
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Skeleton } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Can } from "@/components/can";
import type { StudentRecord } from "@/features/students/student-types";
import { apiClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

interface StudentDetailProps {
  studentId: string;
}

/** Em dash for a missing optional value — the house convention (see
 * dashboard-summary.tsx's formatted tiles). */
const EMPTY = "—";

export function StudentDetail({ studentId }: StudentDetailProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const locale = useLocale();

  const {
    data: student,
    isPending,
    error,
  } = useQuery({
    queryKey: queryKeys.detail("students", "students", studentId),
    queryFn: async () => (await apiClient.get<StudentRecord>(`/students/${studentId}`)).data,
  });

  if (error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(error.code) ? tErrors(error.code) : error.message}
          {error.requestId ? ` ${tErrors("requestId", { requestId: error.requestId })}` : ""}
        </AlertDescription>
      </Alert>
    );
  }

  if (isPending || !student) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const name = student.preferred_name || `${student.first_name} ${student.last_name}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">{name}</h1>
          <p className="text-sm text-muted-foreground tabular-nums">{student.admission_number}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{t(`status.${student.status}`)}</Badge>
          <Can permission="students.student.update">
            <Button asChild variant="outline" size="sm">
              <Link href={`/students/${student.id}/edit`}>{t("form.editTitle")}</Link>
            </Button>
          </Can>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <dl className="contents">
            <Field
              label={t("fields.dateOfBirth")}
              value={formatDate(student.date_of_birth, locale)}
            />
            <Field label={t("fields.gender")} value={t(`gender.${student.gender}`)} />
            <Field
              label={t("fields.admissionDate")}
              value={formatDate(student.admission_date, locale)}
            />
            <Field label={t("fields.bloodGroup")} value={student.blood_group ?? EMPTY} />
            <Field label={t("fields.nationality")} value={student.nationality ?? EMPTY} />
            <Field label={t("fields.religion")} value={student.religion ?? EMPTY} />
            <Field label={t("fields.previousSchool")} value={student.previous_school ?? EMPTY} />
          </dl>
        </CardContent>
      </Card>

      {/* medical_notes is present in the payload only when the server chose to
          include it — its absence is an authorization signal, not something to
          default to a placeholder for. See student-types.ts's StudentRecord. */}
      {"medical_notes" in student ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-foreground">{t("fields.medicalNotes")}</h2>
              <Badge variant="warning">{t("fields.medicalNotesRestricted")}</Badge>
            </div>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {student.medical_notes || EMPTY}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
