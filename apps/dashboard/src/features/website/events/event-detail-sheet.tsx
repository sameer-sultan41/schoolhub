"use client";

import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { ContentDetailSheet, ContentFact } from "@/features/website/shared/content-detail-sheet";
import { useContentErrors } from "@/features/website/shared/content-errors";
import { PublishActions } from "@/features/website/shared/publish-actions";
import { EMPTY_VALUE } from "@/lib/constants";
import { Services } from "@/services";
import { useSchoolEventDetail } from "./event-form-dialog";
import { useEventWhen } from "./use-event-when";

export interface EventPermissions {
  canUpdate: boolean;
  canPublish: boolean;
}

export interface EventDetailSheetProps {
  eventId: string;
  onOpenChange: (open: boolean) => void;
  permissions: EventPermissions;
  onEdit: () => void;
}

/**
 * An event in full, with its actions: Edit and Publish / Unpublish / Archive by its status. An
 * event has no Delete (the API offers none); archiving takes it off the website for good.
 */
export function EventDetailSheet({
  eventId,
  onOpenChange,
  permissions,
  onEdit,
}: EventDetailSheetProps) {
  const t = useTranslations("website.events");
  const tContent = useTranslations("website.content");
  const when = useEventWhen();
  const { asAction } = useContentErrors();
  const query = useSchoolEventDetail(eventId);
  const event = query.data;

  return (
    <ContentDetailSheet
      open
      onOpenChange={onOpenChange}
      detail={
        event && {
          title: event.title,
          status: event.status,
          updatedAt: event.updated_at,
          richText: event.description,
        }
      }
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      richTextLabel={t("form.description")}
      facts={
        event && (
          <>
            <ContentFact label={t("columns.startsAt")} wide>
              {when(event)}
            </ContentFact>
            <ContentFact label={t("form.location")}>{event.location || EMPTY_VALUE}</ContentFact>
            <ContentFact label={tContent("fields.slug")}>
              <span dir="ltr">{`/events/${event.slug}`}</span>
            </ContentFact>
            <ContentFact label={tContent("fields.coverImage")}>
              {event.cover_image_file_id ? tContent("imageOnFile") : EMPTY_VALUE}
            </ContentFact>
          </>
        )
      }
      footer={
        event && (
          <>
            {permissions.canUpdate && (
              <Button variant="outline" onClick={onEdit}>
                {t("actions.edit")}
              </Button>
            )}
            <PublishActions
              status={event.status}
              canPublish={permissions.canPublish}
              publish={asAction(() => Services.schoolEvents.publishSchoolEvent(event.id))}
              unpublish={asAction(() => Services.schoolEvents.unpublishSchoolEvent(event.id))}
              archive={asAction(() => Services.schoolEvents.archiveSchoolEvent(event.id))}
            />
          </>
        )
      }
    />
  );
}
