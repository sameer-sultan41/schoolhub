"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { Services, type TeacherAllocationRecord } from "@/services";
import {
  buildAllocationUpdate,
  hasAllocationChanges,
  recordToAllocationFormValues,
} from "@/services/modules/teacher-allocations/teacher-allocations-helper";
import {
  createAllocationEditFormSchema,
  type AllocationEditFormValues,
} from "@/services/modules/teacher-allocations/teacher-allocations.schema";
import { AllocationIdentitySummary, AllocationTermsFields } from "./allocation-form-fields";
import { useAllocationFormSubmit } from "./use-allocation-mutations";

export interface EditAllocationDialogProps {
  record: TeacherAllocationRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Edits role, override and start date. Only what changed is sent (nothing: no request), never
 * `effective_to` or the identity. Mounted only while open, so each open is fresh.
 */
export function EditAllocationDialog({ record, open, onOpenChange }: EditAllocationDialogProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");

  const schema = useMemo(
    () =>
      createAllocationEditFormSchema({
        required: tCommon("requiredField"),
        weeklyPeriodsInvalid: t("allocations.form.weeklyPeriodsInvalid"),
      }),
    [t, tCommon],
  );
  // What the form opened with: the edit is the difference from it.
  const initialValues = useMemo(() => recordToAllocationFormValues(record), [record]);
  const form = useForm<AllocationEditFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });
  const { handleSubmit, formError, isPending } = useAllocationFormSubmit({
    form,
    mode: "edit",
    save: (values) => {
      const update = buildAllocationUpdate(values, initialValues);
      if (!hasAllocationChanges(update)) return Promise.resolve(undefined);
      return Services.teacherAllocations.updateAllocation(record.id, update);
    },
    onSaved: () => {
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("allocations.form.editTitle")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("allocations.form.submitting")}
    >
      <AllocationIdentitySummary record={record} />
      <AllocationTermsFields />
    </FormDialogLayout>
  );
}
