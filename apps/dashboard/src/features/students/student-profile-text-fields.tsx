"use client";

import type { UseFormReturn } from "react-hook-form"; // a direct dependency (apps/dashboard/package.json) — not re-exported by @schoolhub/ui
import type { StudentFormValues } from "./student-form-schema";
import { StudentTextFieldList } from "./student-text-field-list";

/** The six structurally-identical simple text fields pulled out of
 * `student-form-dialog.tsx` to stay under the 400-line `max-lines` ceiling.
 * `medical_notes` is included here so there is one list to maintain, but is filtered
 * back out below unless the caller says to show it. */
const ALL_FIELDS = [
  ["preferred_name", "preferredName"],
  ["blood_group", "bloodGroup"],
  ["nationality", "nationality"],
  ["religion", "religion"],
  ["previous_school", "previousSchool"],
  ["medical_notes", "medicalNotes"],
] as const;

/**
 * `showMedicalNotes` is a plain boolean, not a permission key or the current user: the
 * permission check (`hasPermission(currentUser, "students.student.update")`) stays in
 * `student-form-dialog.tsx`, the caller — this component has no idea what a permission
 * is, same as `StudentAddressFields` has no idea what a Select or a query is. It only
 * knows whether to render one extra field.
 */
export function StudentProfileTextFields({
  form,
  showMedicalNotes,
}: {
  form: UseFormReturn<StudentFormValues>;
  showMedicalNotes: boolean;
}) {
  const fields = ALL_FIELDS.filter(([name]) => name !== "medical_notes" || showMedicalNotes);
  return <StudentTextFieldList form={form} fields={fields} namespace="fields" />;
}
