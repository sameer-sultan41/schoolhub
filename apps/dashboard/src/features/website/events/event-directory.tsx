"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";

import { ContentDirectoryCard } from "@/features/website/shared/content-directory-card";
import { useContentDirectory } from "@/features/website/shared/use-content-directory";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type SchoolEventRecord } from "@/services";
import {
  EVENT_SORT_FIELD,
  SCHOOL_EVENTS_RESOURCE,
} from "@/services/modules/website/school-events/school-events-constant";
import { useEventColumns } from "./event-columns";
import { EventDetailSheet } from "./event-detail-sheet";
import { EventFormDialog } from "./event-form-dialog";

type Target = { event: SchoolEventRecord; action: "view" | "edit" };

/**
 * The `/website/events` directory: every event, searched and filtered by status, server
 * paginated, with the view state in the URL. A title opens the detail sheet (the lifecycle);
 * Edit is the row's own. Each dialog and the sheet are mounted only while open.
 */
export function EventDirectory() {
  const t = useTranslations("website.events");
  const { data: user } = useCurrentUser();
  const permissions = {
    canUpdate: hasPermission(user, "website.school-event.update"),
    canPublish: hasPermission(user, "website.school-event.publish"),
  };
  const [target, setTarget] = useState<Target | null>(null);

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleOpen = useCallback((event: SchoolEventRecord) => {
    setTarget({ event, action: "view" });
  }, []);
  const handleEdit = useCallback((event: SchoolEventRecord) => {
    setTarget({ event, action: "edit" });
  }, []);

  const columns = useEventColumns({
    canUpdate: permissions.canUpdate,
    canPublish: permissions.canPublish,
    onOpen: handleOpen,
    onEdit: handleEdit,
  });
  const directory = useContentDirectory({
    columns,
    resource: SCHOOL_EVENTS_RESOURCE,
    sortField: EVENT_SORT_FIELD,
    fetchPage: Services.schoolEvents.fetchSchoolEventPage,
  });

  const close = (open: boolean) => {
    if (!open) setTarget(null);
  };

  return (
    <ContentDirectoryCard
      directory={directory}
      icon={CalendarDays}
      labels={{
        caption: t("list.caption"),
        searchPlaceholder: t("list.searchPlaceholder"),
        loadError: t("list.loadError"),
        emptyTitle: t("list.emptyTitle"),
        emptyDescription: t("list.emptyDescription"),
      }}
    >
      {target?.action === "view" && (
        <EventDetailSheet
          eventId={target.event.id}
          onOpenChange={close}
          permissions={permissions}
          onEdit={() => {
            setTarget({ event: target.event, action: "edit" });
          }}
        />
      )}
      {target?.action === "edit" && (
        <EventFormDialog open onOpenChange={close} eventId={target.event.id} />
      )}
    </ContentDirectoryCard>
  );
}
