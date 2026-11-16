import type { QueryParams } from "@schoolhub/api-client";

import { toContentQueryParams } from "@/services/shared/website-content";
import type { SchoolEventQuery } from "./school-events-type";

/** The events list's query string: the shared content filters plus the `starts_at` window. */
export function toSchoolEventQueryParams(query: SchoolEventQuery): QueryParams {
  return toContentQueryParams(query, {
    starts_after: query.startsAfter,
    starts_before: query.startsBefore,
  });
}
