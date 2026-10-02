"use client";

import type { UseFormReturn } from "react-hook-form"; // a direct dependency (apps/dashboard/package.json) — not re-exported by @schoolhub/ui
import type { StudentFormValues } from "./student-form-schema";
import { StudentTextFieldList } from "./student-text-field-list";

const ADDRESS_FIELDS = [
  ["address_line1", "line1"],
  ["address_line2", "line2"],
  ["address_city", "city"],
  ["address_state", "state"],
  ["address_postal_code", "postalCode"],
  ["address_country", "country"],
] as const;

export function StudentAddressFields({ form }: { form: UseFormReturn<StudentFormValues> }) {
  return <StudentTextFieldList form={form} fields={ADDRESS_FIELDS} namespace="address" />;
}
