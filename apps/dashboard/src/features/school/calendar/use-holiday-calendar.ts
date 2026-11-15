"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  HOLIDAY_CALENDAR_RESOURCE,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
} from "@/services/modules/school-organization/school-organization-constant";

/** The school calendar (`GET /holiday-calendar`): one cache entry the working week and the
 * holidays list share, invalidated with the rest of the school-organization module. */
export function useHolidayCalendar() {
  return useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, HOLIDAY_CALENDAR_RESOURCE),
    queryFn: () => Services.schoolOrganization.fetchHolidayCalendar(),
  });
}
