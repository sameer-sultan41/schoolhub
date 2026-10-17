"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { Services } from "@/services";
import {
  buildAllocateInput,
  defaultAllocationFormValues,
} from "@/services/modules/teacher-allocations/teacher-allocations-helper";
import {
  createAllocationFormSchema,
  type AllocationFormValues,
} from "@/services/modules/teacher-allocations/teacher-allocations.schema";
import { AllocationIdentityFields, AllocationTermsFields } from "./allocation-form-fields";
import { useAllocationFormSubmit } from "./use-allocation-mutations";

export interface AllocateTeacherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The session the allocation is made in: the screen's. */
  sessionId: string;
}

/** Gives a section's subject a teacher. Mounted only while open, so each open is fresh. */
export function AllocateTeacherDialog({
  open,
  onOpenChange,
  sessionId,
}: AllocateTeacherDialogProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");

  // Zod can't reach next-intl, so the schema takes the translated messages.
  const schema = useMemo(
    () =>
      createAllocationFormSchema({
        required: tCommon("requiredField"),
        weeklyPeriodsInvalid: t("allocations.form.weeklyPeriodsInvalid"),
      }),
    [t, tCommon],
  );
  const form = useForm<AllocationFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultAllocationFormValues(),
  });
  const { handleSubmit, formError, isPending } = useAllocationFormSubmit({
    form,
    mode: "create",
    save: (values) =>
      Services.teacherAllocations.allocateTeacher(buildAllocateInput(values, sessionId)),
    onSaved: () => {
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("allocations.form.createTitle")}
      description={t("allocations.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("allocations.form.submitting")}
    >
      <AllocationIdentityFields form={form} sessionId={sessionId} />
      <AllocationTermsFields />
    </FormDialogLayout>
  );
}
