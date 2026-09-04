"use client";

import { ApiError } from "@schoolhub/api-client";
import { Alert, AlertDescription, Skeleton } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
  const tErrors = useTranslations("errors");

  const {
    data: staff,
    isPending,
    error,
  } = useQuery({
    queryKey: queryKeys.detail("staff", "staff", staffId),
    queryFn: async () => (await apiClient.get<StaffRecord>(`/staff/${staffId}`)).data,
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

  if (isPending || !staff) {
    return <Skeleton className="h-96 w-full" />;
  }

  return <StaffForm mode="edit" staff={staff} />;
}
