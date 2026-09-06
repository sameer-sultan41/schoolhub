"use client";

import { Skeleton } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { StaffForm } from "@/features/staff/staff-form";
import type { StaffRecord } from "@/features/staff/staff-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface EditStaffFormProps {
  staffId: string;
}

/** Loads the record the edit form needs — a thin client wrapper so the route
 * page itself can stay an async server component (chrome only). Mirrors
 * edit-student-form.tsx exactly. */
export function EditStaffForm({ staffId }: EditStaffFormProps) {
  const {
    data: staff,
    isPending,
    error,
  } = useQuery({
    queryKey: queryKeys.detail("staff", "staff", staffId),
    queryFn: async () => (await apiClient.get<StaffRecord>(`/staff/${staffId}`)).data,
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

  return <StaffForm mode="edit" staff={staff} />;
}
