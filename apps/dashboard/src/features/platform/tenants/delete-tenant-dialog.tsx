"use client";

import { useForm, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Checkbox,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { hasPermission } from "@/lib/permissions";
import { Services, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { ReasonField } from "@/features/platform/shared/reason-field";
import { TenantExportPanel } from "./tenant-export-panel";

interface DeleteValues {
  reason: string;
  waive_export: boolean;
}

const FIELDS = ["reason", "waive_export"] as const;

/** The statuses whose `:delete` needs a succeeded export or a waiver (platform-admin.md §7.4). */
const NEEDS_EXPORT = new Set<TenantRecord["status"]>(["active", "suspended"]);

/**
 * Starts deprovisioning: the school stops working at once and its data is kept for the retention
 * window, inside which `:restore` brings it back. From `active` or `suspended` the server wants a
 * succeeded export of the school's data first, or an explicit waiver; without either it answers
 * 409 `export_required`. A school still provisioning has nothing to export.
 *
 * Mounting contract: mounted only while open, so each open has a fresh `Idempotency-Key`.
 */
export function DeleteTenantDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: TenantRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("platform");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);
  const { data: user } = useCurrentUser();
  const needsExport = NEEDS_EXPORT.has(tenant.status);
  const canExport = hasPermission(user, PLATFORM_KEYS.tenantExport);

  const form = useForm<DeleteValues>({ defaultValues: { reason: "", waive_export: false } });
  const reason = useWatch({ control: form.control, name: "reason" });
  const key = useIdempotencyKey(form);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: FIELDS,
    fallbackMessage: tCommon("submitFailed"),
    mutationFn: (values: DeleteValues) =>
      Services.platform.deleteTenant(
        tenant.id,
        { reason: values.reason.trim(), waive_export: needsExport && values.waive_export },
        { idempotencyKey: key.current() },
      ),
    onSuccess: () => {
      key.clear();
      invalidate();
      toast.success(t("lifecycle.delete.done", { name: tenant.name }));
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("lifecycle.delete.title", { name: tenant.name })}
      description={t("lifecycle.delete.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("lifecycle.delete.submitting")}
      submitLabel={t("lifecycle.delete.submit")}
      submitDisabled={reason.trim() === ""}
    >
      <ReasonField form={form} name="reason" />
      {needsExport && (
        <>
          {canExport && <TenantExportPanel tenantId={tenant.id} />}
          <FormField
            control={form.control}
            name="waive_export"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked === true);
                      }}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">{t("lifecycle.delete.waive")}</FormLabel>
                </div>
                <FormDescription>{t("lifecycle.delete.waiveHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </FormDialogLayout>
  );
}
