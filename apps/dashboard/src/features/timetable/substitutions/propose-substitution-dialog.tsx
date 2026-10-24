"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  SUBSTITUTION_ERROR_FIELDS,
  SUBSTITUTIONS_QUERY_MODULE,
} from "@/services/modules/teacher-substitutions/teacher-substitutions-constant";
import { buildProposeInput } from "@/services/modules/teacher-substitutions/teacher-substitutions-helper";
import {
  createProposeFormSchema,
  type ProposeFormValues,
} from "@/services/modules/teacher-substitutions/teacher-substitutions.schema";
import { ProposeSubstitutionFields } from "./propose-substitution-fields";

export interface ProposeSubstitutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The session whose published classes can be covered: the current one. */
  academicSessionId: string;
}

const EMPTY: ProposeFormValues = {
  date: "",
  absent_staff_id: "",
  timetable_slot_id: "",
  substitute_staff_id: "",
  room_id: "",
  reason: "",
};

/**
 * Proposes cover for one class on one date. The server re-checks every rule (the right
 * weekday, the substitute still free, a room move not clashing) and names the field it
 * refuses on, which shows under it.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is fresh.
 */
export function ProposeSubstitutionDialog({
  open,
  onOpenChange,
  academicSessionId,
}: ProposeSubstitutionDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const schema = useMemo(
    () => createProposeFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<ProposeFormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ProposeFormValues) =>
      Services.teacherSubstitutions.proposeSubstitution(buildProposeInput(values)),
    knownFields: SUBSTITUTION_ERROR_FIELDS,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.module(SUBSTITUTIONS_QUERY_MODULE),
      });
      toast.success(t("substitutions.proposed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("substitutions.form.createTitle")}
      description={t("substitutions.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <ProposeSubstitutionFields form={form} academicSessionId={academicSessionId} />
    </FormDialogLayout>
  );
}
