/** The events domain's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */
export const SCHOOL_EVENTS_RESOURCE = "school-events";

/** `SchoolEvent.location`'s column length (`website_cms/models.py`). */
export const EVENT_LOCATION_MAX = 200;

/** Sortable column id -> `SchoolEventViewSet.ordering_fields`. */
export const EVENT_SORT_FIELD: Readonly<Record<string, string>> = {
  title: "title",
  status: "status",
  starts_at: "starts_at",
  updated_at: "updated_at",
};
