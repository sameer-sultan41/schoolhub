"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, Button, Card, CardContent, Form, Skeleton } from "@schoolhub/ui";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type AttendanceSettings } from "@/services";
import {
  ATTENDANCE_SETTINGS_ERROR_FIELDS,
  ATTENDANCE_SETTINGS_ID,
  ATTENDANCE_SETTINGS_QUERY_MODULE,
  ATTENDANCE_SETTINGS_RESOURCE,
} from "@/services/modules/attendance-settings/attendance-settings-constant";
import {
  buildSettingsChanges,
  settingsToFormValues,
} from "@/services/modules/attendance-settings/attendance-settings-helper";
import {
  createAttendanceSettingsFormSchema,
  type AttendanceSettingsFormValues,
} from "@/services/modules/attendance-settings/attendance-settings.schema";
import { STUDENT_ATTENDANCE_QUERY_MODULE } from "@/services/modules/student-attendance/student-attendance-constant";
import { AttendanceSettingsFields } from "./attendance-settings-fields";

const settingsQueryKey = () =>
  queryKeys.detail(
    ATTENDANCE_SETTINGS_QUERY_MODULE,
    ATTENDANCE_SETTINGS_RESOURCE,
    ATTENDANCE_SETTINGS_ID,
  );

/**
 * `/attendance/settings`: the tenant's attendance mode, lock window and leave escalation
 * threshold (`GET/PATCH /attendance-settings`). Only the settings the viewer changed are sent,
 * and a server error that names a field (the timetable-off refusal of `period` is on
 * `attendance_mode`) is shown under it.
 */
export function AttendanceSettingsForm() {
  const t = useTranslations("attendance");
  const tErrors = useTranslations("errors");
  const { data: currentUser } = useCurrentUser();
  const query = useQuery({
    queryKey: settingsQueryKey(),
    queryFn: () => Services.attendanceSettings.fetchSettings(),
  });

  function body() {
    // Data first: a failed background refetch must not unmount a form being edited.
    if (query.data) {
      return (
        <SettingsFormBody
          settings={query.data}
          canUpdate={hasPermission(currentUser, "school.settings.update")}
          permissionsKnown={currentUser !== undefined}
        />
      );
    }
    if (query.isError) {
      return (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("settings.loadError"))}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("settings.loading")}</span>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("settings.title")} description={t("settings.summary")} />
      </Toolbar>
      {body()}
    </>
  );
}

interface SettingsFormBodyProps {
  settings: AttendanceSettings;
  canUpdate: boolean;
  /** False while the viewer's permissions load: the form stays read-only, with no notice. */
  permissionsKnown: boolean;
}

/** Mounted once the settings are known, so the form always starts from them. */
function SettingsFormBody({ settings, canUpdate, permissionsKnown }: SettingsFormBodyProps) {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const invalidateSettings = useInvalidateModule(ATTENDANCE_SETTINGS_QUERY_MODULE);
  // A register and My registers carry the mode they were read under; a switch stales them.
  const invalidateRegisters = useInvalidateModule(STUDENT_ATTENDANCE_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createAttendanceSettingsFormSchema({
        lockWindowInvalid: t("settings.lockWindow.invalid"),
        thresholdInvalid: t("settings.escalation.invalid"),
      }),
    [t],
  );
  const form = useForm<AttendanceSettingsFormValues>({
    resolver: zodResolver(schema),
    defaultValues: settingsToFormValues(settings),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: AttendanceSettingsFormValues) =>
      Services.attendanceSettings.updateSettings(buildSettingsChanges(values, settings)),
    knownFields: ATTENDANCE_SETTINGS_ERROR_FIELDS,
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsQueryKey(), saved);
      invalidateSettings();
      invalidateRegisters();
      form.reset(settingsToFormValues(saved));
      toast.success(t("settings.saved"));
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
                {t("settings.readOnly")}
              </Alert>
            )}
            {formError && <Alert variant="destructive">{formError}</Alert>}
            <AttendanceSettingsFields form={form} canUpdate={canUpdate} />
            {canUpdate && (
              <Button
                type="submit"
                disabled={!form.formState.isDirty}
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
