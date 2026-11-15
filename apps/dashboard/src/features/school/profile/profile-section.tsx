"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, Button, Card, CardContent, Form, Skeleton } from "@schoolhub/ui";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { SCHOOL_SETTINGS_UPDATE } from "@/features/school/school-permissions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { rekeyFieldErrors, resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type SchoolSettingsRecord } from "@/services";
import {
  SCHOOL_PROFILE_ERROR_FIELDS,
  SCHOOL_PROFILE_FIELD_ALIASES,
} from "@/services/modules/school-settings/school-settings-constant";
import {
  buildSchoolProfileBody,
  settingsToProfileValues,
} from "@/services/modules/school-settings/school-settings-helper";
import {
  createSchoolProfileSchema,
  type SchoolProfileFormValues,
} from "@/services/modules/school-settings/school-settings.schema";
import { SchoolProfileFields } from "./school-profile-fields";

/**
 * The Profile & settings section as one unit: the school's name, logo, brand colour, timezone,
 * locale and currency (`GET/PATCH /school-settings`). The calendar has its own section.
 */
export function ProfileSection() {
  const t = useTranslations("school");
  const tErrors = useTranslations("errors");
  const { data: currentUser } = useCurrentUser();
  const query = useQuery({
    queryKey: queryKeys.schoolSettings(),
    queryFn: () => Services.schoolSettings.fetchSchoolSettings(),
  });

  function body() {
    // Data first: a failed background refetch must not unmount a form being edited.
    if (query.data) {
      return (
        <ProfileFormBody
          settings={query.data}
          canUpdate={hasPermission(currentUser, SCHOOL_SETTINGS_UPDATE)}
          permissionsKnown={currentUser !== undefined}
        />
      );
    }
    if (query.isError) {
      return (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("profile.loadError"))}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("profile.loading")}</span>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarHeading title={t("profile.title")} description={t("profile.summary")} />
      </Toolbar>
      {body()}
    </div>
  );
}

interface ProfileFormBodyProps {
  settings: SchoolSettingsRecord;
  canUpdate: boolean;
  /** False while the viewer's permissions load: no Save and no notice yet. */
  permissionsKnown: boolean;
}

/** Mounted once the settings are known, so the form always starts from them. */
function ProfileFormBody({ settings, canUpdate, permissionsKnown }: ProfileFormBodyProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);

  const schema = useMemo(
    () =>
      createSchoolProfileSchema({
        required: tCommon("requiredField"),
        colorInvalid: t("form.colorInvalid"),
        currencyInvalid: t("profile.currencyInvalid"),
      }),
    [t, tCommon],
  );
  const form = useForm<SchoolProfileFormValues>({
    resolver: zodResolver(schema),
    defaultValues: settingsToProfileValues(settings),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: SchoolProfileFormValues) => {
      try {
        return await Services.schoolSettings.updateSchoolSettings(
          buildSchoolProfileBody(values, settings),
        );
      } catch (error) {
        // The colour's error is nested under `branding` on the wire.
        throw rekeyFieldErrors(error, (field) => SCHOOL_PROFILE_FIELD_ALIASES[field]);
      }
    },
    knownFields: SCHOOL_PROFILE_ERROR_FIELDS,
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.schoolSettings(), saved);
      // `/auth/me` names the school (`tenant_summary`): a new name stales it.
      if (saved.name !== settings.name) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser() });
      }
      form.reset(settingsToProfileValues(saved));
      toast.success(t("profile.saved"));
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <Card>
      <CardContent className="p-6">
        <Form {...form}>
          <form noValidate onSubmit={handleSubmit} className="max-w-2xl space-y-6">
            {permissionsKnown && !canUpdate && (
              <Alert variant="info" appearance="light">
                {t("profile.readOnly")}
              </Alert>
            )}
            {formError && <Alert variant="destructive">{formError}</Alert>}
            {/* A native `disabled` reaches every control inside, the logo picker included, so a
                viewer can't start an upload. */}
            <fieldset disabled={!canUpdate} className="min-w-0 space-y-6">
              <SchoolProfileFields
                form={form}
                settings={settings}
                readOnly={!canUpdate}
                onUploadingChange={setIsUploading}
              />
            </fieldset>
            {canUpdate && (
              <Button
                type="submit"
                disabled={!form.formState.isDirty || isUploading}
                isLoading={isPending}
                loadingLabel={tCommon("saving")}
              >
                {tCommon("save")}
              </Button>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
