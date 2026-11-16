"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useContentFieldMessages } from "@/features/website/shared/content-fields";
import { ContentFormPending } from "@/features/website/shared/content-form-pending";
import { ContentTitleSlugFields } from "@/features/website/shared/content-title-slug-fields";
import { ImageFileField } from "@/features/website/shared/image-file-field";
import { RichTextBlocksField } from "@/features/website/shared/rich-text-blocks-field";
import {
  submitAfterUploads,
  UploadTrackerProvider,
  useUploadTracker,
} from "@/features/website/shared/upload-tracker";
import { useContentFormSubmit } from "@/features/website/shared/use-content-form-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { queryKeys } from "@/lib/query-client";
import { Services, type SchoolEventDetail } from "@/services";
import { SCHOOL_EVENTS_RESOURCE } from "@/services/modules/website/school-events/school-events-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { EventDateFields } from "./event-date-fields";
import {
  buildEventInput,
  EVENT_FORM_FIELDS,
  eventDetailToFormValues,
  eventFormDefaults,
  eventFormSchema,
  type EventFormValues,
} from "./event-form-schema";

/** The public path an event's slug sits under. */
const EVENTS_PATH_PREFIX = "/events/";

export interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The event to edit; omitted to add one. */
  eventId?: string;
}

/** The event detail's query: the edit dialog and the detail sheet share its cache entry. */
export function useSchoolEventDetail(eventId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.detail(WEBSITE_QUERY_MODULE, SCHOOL_EVENTS_RESOURCE, eventId ?? ""),
    queryFn: () => Services.schoolEvents.fetchSchoolEvent(eventId ?? ""),
    enabled: eventId !== undefined,
  });
}

/**
 * Adds an event or edits one: title and address, when (all day, start, optional end) and where,
 * a cover image and the rich-text description. An end before the start is refused here, and
 * the server's own refusal (`end_before_start`) shows under the end too. An edit waits for the
 * event's detail (the list lacks its description) before the form mounts.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function EventFormDialog({ open, onOpenChange, eventId }: EventFormDialogProps) {
  const t = useTranslations("website.events");
  const detailQuery = useSchoolEventDetail(eventId);

  if (eventId !== undefined && detailQuery.data === undefined) {
    return (
      <ContentFormPending
        open={open}
        onOpenChange={onOpenChange}
        title={t("form.editTitle")}
        error={detailQuery.error}
        onRetry={() => {
          void detailQuery.refetch();
        }}
      />
    );
  }
  return <EventForm open={open} onOpenChange={onOpenChange} detail={detailQuery.data} />;
}

function EventForm({
  open,
  onOpenChange,
  detail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: SchoolEventDetail | undefined;
}) {
  const t = useTranslations("website.events");
  const tContent = useTranslations("website.content");
  const tReasons = useTranslations("website.reasons");
  const tCommon = useTranslations("common");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const tracker = useUploadTracker();
  const fieldMessages = useContentFieldMessages();
  const mode = detail ? "edit" : "create";

  const schema = useMemo(
    () =>
      eventFormSchema({
        ...fieldMessages,
        startRequired: t("validation.startRequired"),
        endBeforeStart: tReasons("end_before_start"),
      }),
    [fieldMessages, t, tReasons],
  );
  const form = useForm<EventFormValues>({
    resolver: zodResolver(schema),
    defaultValues: detail ? eventDetailToFormValues(detail) : eventFormDefaults(),
  });

  const { handleSubmit, formError, isPending } = useContentFormSubmit({
    form,
    save: (values: EventFormValues) =>
      detail
        ? Services.schoolEvents.updateSchoolEvent(detail.id, buildEventInput(values, "edit"))
        : Services.schoolEvents.createSchoolEvent(buildEventInput(values, "create")),
    fields: EVENT_FORM_FIELDS,
    richTextName: "description",
    onSuccess: () => {
      invalidateWebsite();
      toast.success(t(mode === "edit" ? "saved" : "created"));
      onOpenChange(false);
    },
  });

  return (
    <UploadTrackerProvider value={tracker}>
      <FormDialogLayout
        open={open}
        onOpenChange={onOpenChange}
        title={t(mode === "edit" ? "form.editTitle" : "form.createTitle")}
        description={t("form.intro")}
        form={form}
        onSubmit={submitAfterUploads(tracker, handleSubmit)}
        formError={formError}
        isPending={isPending}
        submittingLabel={tCommon("saving")}
        submitDisabled={tracker.isUploading}
      >
        <ContentTitleSlugFields
          form={form}
          pathPrefix={EVENTS_PATH_PREFIX}
          autoSlug={mode === "create"}
        />
        <EventDateFields form={form} />
        <ImageFileField
          key={detail?.id ?? "new"}
          form={form}
          name="cover_image_file_id"
          label={tContent("fields.coverImage")}
        />
        <RichTextBlocksField form={form} name="description" label={t("form.description")} />
      </FormDialogLayout>
    </UploadTrackerProvider>
  );
}
