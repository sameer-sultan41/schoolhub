"use client";

import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import {
  createReasonSchema,
  type ReasonFormValues,
} from "@/services/modules/platform/platform.schema";
import { usePlatformFormMessages } from "@/features/platform/shared/use-platform-form-messages";
import { ReasonField } from "@/features/platform/shared/reason-field";

export interface TenantReasonDialogProps {
  /** `suspend` or `restore`: the two lifecycle actions whose only input is a required reason. */
  action: "suspend" | "restore";
  tenant: TenantRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FIELDS = ["reason"] as const;

/**
 * Suspends a school, or restores a deprovisioned one inside its retention window (as suspended).
 * The server refuses a blank reason, so Submit waits for one. The request carries this dialog's
 * `Idempotency-Key`: a retry after a lost answer replays the first, and a refused attempt (which
 * the server never stores) runs again under the same key. Editing the reason starts a new key.
 *
 * Mounting contract: the caller mounts it only while open, so every open starts empty with a
 * fresh key.
 */
export function TenantReasonDialog({
  action,
  tenant,
  open,
  onOpenChange,
}: TenantReasonDialogProps) {
  const t = useTranslations("platform");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);

  const messages = usePlatformFormMessages();
  const schema = useMemo(() => createReasonSchema(messages), [messages]);
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  });
  const reason = useWatch({ control: form.control, name: "reason" });
  const key = useIdempotencyKey(form);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: FIELDS,
    fallbackMessage: tCommon("submitFailed"),
    mutationFn: (values: ReasonFormValues) => {
      const run =
        action === "suspend" ? Services.platform.suspendTenant : Services.platform.restoreTenant;
      return run(tenant.id, { reason: values.reason }, { idempotencyKey: key.current() });
    },
    onSuccess: () => {
      key.clear();
      invalidate();
      toast.success(t(`lifecycle.${action}.done`, { name: tenant.name }));
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t(`lifecycle.${action}.title`, { name: tenant.name })}
      description={t(`lifecycle.${action}.description`)}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t(`lifecycle.${action}.submitting`)}
      submitLabel={t(`lifecycle.${action}.submit`)}
      submitDisabled={reason.trim() === ""}
    >
      <ReasonField form={form} name="reason" />
    </FormDialogLayout>
  );
}
