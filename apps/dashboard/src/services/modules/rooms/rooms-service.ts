import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toRoomBody, toRoomQueryParams } from "./rooms-helper";
import type { RoomInput, RoomPageQuery, RoomRecord } from "./rooms-type";

/** The rooms API calls (`/rooms`), reached through `Services.rooms.*`. */

export async function fetchRoomPage(query: RoomPageQuery): Promise<Page<RoomRecord>> {
  return fetchPage<RoomRecord>(apiClient, endpoints.rooms.list, {
    query: toRoomQueryParams(query),
  });
}

/** A campus's rooms in service, by code: the grid cell's room picker. One `MAX_PAGE_SIZE`
 * page, which one campus's rooms fit in. */
export async function fetchActiveRooms(campusId: string): Promise<RoomRecord[]> {
  const { items } = await fetchPage<RoomRecord>(apiClient, endpoints.rooms.list, {
    query: { campus_id: campusId, is_active: true, ordering: "code", page_size: MAX_PAGE_SIZE },
  });
  return items;
}

export async function createRoom(input: RoomInput): Promise<RoomRecord> {
  const { data } = await apiClient.post<RoomRecord>(endpoints.rooms.list, toRoomBody(input));
  return data;
}

export async function updateRoom(id: string, input: RoomInput): Promise<RoomRecord> {
  const { data } = await apiClient.patch<RoomRecord>(endpoints.rooms.detail(id), toRoomBody(input));
  return data;
}

export async function deleteRoom(id: string): Promise<void> {
  await apiClient.delete(endpoints.rooms.detail(id));
}
