"use client";

import { ApiError } from "@schoolhub/api-client";
import { Alert, AlertDescription, Skeleton } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { StudentForm } from "@/features/students/student-form";
import type { StudentRecord } from "@/features/students/student-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface EditStudentFormProps {
  studentId: string;
}

/** Loads the record the edit form needs — a thin client wrapper so the route
 * page itself can stay an async server component (chrome only). */
export function EditStudentForm({ studentId }: EditStudentFormProps) {
  const tErrors = useTranslations("errors");

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
    return <Skeleton className="h-96 w-full" />;
  }

  return <StudentForm mode="edit" student={student} />;
}
