"use client";

import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ExternalLink } from "lucide-react";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { type GrantStarted, Services, type TenantRecord } from "@/services";
import {
  DEFAULT_IMPERSONATION_MINUTES,
  IMPERSONATION_DURATIONS,
  IMPERSONATION_REASON_MAX_LENGTH,
} from "@/services/modules/platform/platform-constant";
import {
  createImpersonateSchema,
  type ImpersonateFormValues,
} from "@/services/modules/platform/platform.schema";
import { ReasonField } from "@/features/platform/shared/reason-field";
import { usePlatformFormMessages } from "@/features/platform/shared/use-platform-form-messages";
import { TenantUserField } from "./tenant-user-field";

const FIELDS = ["user_id", "reason", "duration_minutes"] as const;

export interface ImpersonateUserDialogProps {
  tenant: TenantRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Starts acting as one of a school's users (ADR-0037): the user, a reason for the audit log and a
 * duration. The answer's handoff link opens the school's dashboard in a new tab, as a link the
 * operator follows: a tab opened by script after the request would meet the popup blocker.
 *
 * The link carries a single-use code, so it lives only in this dialog's state (and a mutation
 * cache entry dropped as soon as it settles unobserved): closing the dialog forgets it. Mounting
 * contract: the caller mounts it only while open, so every open starts empty.
 */
export function ImpersonateUserDialog({ tenant, open, onOpenChange }: ImpersonateUserDialogProps) {
  const [grant, setGrant] = useState<GrantStarted | null>(null);

  return grant ? (
    <ImpersonationStarted tenant={tenant} grant={grant} open={open} onOpenChange={onOpenChange} />
  ) : (
    <ImpersonateForm tenant={tenant} open={open} onOpenChange={onOpenChange} onStarted={setGrant} />
  );
}

function ImpersonateForm({
  tenant,
  open,
  onOpenChange,
  onStarted,
}: ImpersonateUserDialogProps & { onStarted: (grant: GrantStarted) => void }) {
  const t = useTranslations("platform.impersonation");
  const tCommon = useTranslations("common");
  const messages = usePlatformFormMessages();
  const schema = useMemo(() => createImpersonateSchema(messages), [messages]);
  const form = useForm<ImpersonateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      user_id: "",
      reason: "",
      duration_minutes: String(DEFAULT_IMPERSONATION_MINUTES),
    },
  });
  const [userId, reason] = useWatch({ control: form.control, name: ["user_id", "reason"] });
  const durations = useMemo(
    () =>
      IMPERSONATION_DURATIONS.map((minutes) => ({
        id: String(minutes),
        name: t("minutes", { count: minutes }),
      })),
    [t],
  );

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: FIELDS,
    fallbackMessage: tCommon("submitFailed"),
    // The answer holds the single-use code: nothing keeps it once the dialog is gone.
    gcTime: 0,
    mutationFn: (values: ImpersonateFormValues) =>
      Services.platform.impersonateUser(tenant.id, {
        user_id: values.user_id,
        reason: values.reason.trim(),
        duration_minutes: Number(values.duration_minutes),
      }),
    onSuccess: onStarted,
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("title", { name: tenant.name })}
      description={t("description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("submitting")}
      submitLabel={t("submit")}
      submitDisabled={userId === "" || reason.trim() === ""}
    >
      <TenantUserField form={form} tenantId={tenant.id} />
      <ReasonField
        form={form}
        name="reason"
        maxLength={IMPERSONATION_REASON_MAX_LENGTH}
        description={t("reasonHint")}
      />
      <FormSelectField
        form={form}
        name="duration_minutes"
        label={t("duration")}
        placeholder={t("duration")}
        options={durations}
      />
    </FormDialogLayout>
  );
}

function ImpersonationStarted({
  tenant,
  grant,
  open,
  onOpenChange,
}: ImpersonateUserDialogProps & { grant: GrantStarted }) {
  const t = useTranslations("platform.impersonation.started");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("title")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("body", {
              time: format.dateTime(new Date(grant.expires_at), { timeStyle: "short" }),
            })}
          </p>
          <Button asChild>
            <a href={grant.handoff_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              {t("open", { school: tenant.name })}
            </a>
          </Button>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tCommon("close")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
