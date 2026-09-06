"use client";

import { Skeleton } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { ApiErrorAlert } from "@/components/api-error-alert";
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
  const {
    data: student,
    isPending,
    error,
  } = useQuery({
    queryKey: queryKeys.detail("students", "students", studentId),
    queryFn: async () => (await apiClient.get<StudentRecord>(`/students/${studentId}`)).data,
  });

  // One copy of the envelope, shared with every other screen — see
  // components/api-error-alert.tsx.
  if (error) {
    return <ApiErrorAlert error={error} />;
  }

  // `isPending` alone: TanStack Query's result is a discriminated union, so once the
  // error branch above has returned, not-pending means status "success" and `data` is
  // non-undefined. The `!data` half was load-bearing only while the error check was
  // `error instanceof ApiError`, which did not narrow the union at all.
  if (isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  return <StudentForm mode="edit" student={student} />;
}
