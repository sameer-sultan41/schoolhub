"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { ROOMS_ACTIVE_RESOURCE, ROOMS_QUERY_MODULE } from "@/services/modules/rooms/rooms-constant";

/** A campus's rooms in service, for a room picker (the grid cell, cover). Waits for a campus;
 * a room write refreshes it through the rooms module. */
export function useActiveRooms(campusId: string) {
  return useQuery({
    queryKey: queryKeys.list(ROOMS_QUERY_MODULE, ROOMS_ACTIVE_RESOURCE, { campusId }),
    queryFn: () => Services.rooms.fetchActiveRooms(campusId),
    enabled: campusId !== "",
  });
}
