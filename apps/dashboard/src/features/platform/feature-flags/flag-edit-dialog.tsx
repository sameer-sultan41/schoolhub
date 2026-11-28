"use client";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSwitchField } from "@/components/form-switch-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeatureFlagRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { usePlatformErrorDescriber } from "@/features/platform/shared/use-platform-error";

interface FlagValues {
  default_enabled: boolean;
  is_kill_switch: boolean;
}

/**
 * A flag's platform default and kill switch, for every school at once. Once a flag exists the
 * console owns these two fields: a deploy no longer overwrites them (platform-admin.md §20).
 * Mounting contract: mounted only while open.
 */
export function FlagEditDialog({
  flag,
  onOpenChange,
}: {
  flag: FeatureFlagRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("platform.flags");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);
  const describeError = usePlatformErrorDescriber();

  const form = useForm<FlagValues>({
    defaultValues: { default_enabled: flag.default_enabled, is_kill_switch: flag.is_kill_switch },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: ["default_enabled", "is_kill_switch"],
    fallbackMessage: tCommon("submitFailed"),
    describeError,
    mutationFn: (values: FlagValues) => Services.platform.updateFlag(flag.id, values),
    onSuccess: (saved) => {
      invalidate();
      toast.success(t("saved", { key: saved.key }));
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open
      onOpenChange={onOpenChange}
      title={t("editTitle", { key: flag.key })}
      description={t("editDescription")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <FormSwitchField
        form={form}
        name="default_enabled"
        label={t("defaultEnabled")}
        description={t("defaultEnabledHint")}
      />
      <FormSwitchField
        form={form}
        name="is_kill_switch"
        label={t("killSwitch")}
        description={t("killSwitchHint")}
      />
    </FormDialogLayout>
  );
}
