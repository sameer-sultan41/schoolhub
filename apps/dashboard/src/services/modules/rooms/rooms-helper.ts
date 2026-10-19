import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_ROOM_TYPE,
  ROOM_STATUS,
  ROOMS_BODY_FIELDS,
  ROOMS_QUERY_FIELDS,
} from "./rooms-constant";
import type { RoomFormValues } from "./rooms.schema";
import type { RoomInput, RoomPageQuery, RoomRecord, RoomType } from "./rooms-type";

/** The rooms module's pure helpers: plain data in, plain data out. */

export function toRoomBody(input: Partial<RoomInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, ROOMS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function toRoomQueryParams(
  query: RoomPageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(
    query,
    ROOMS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

/** The status filter -> `is_active`: `all` (or anything else) is no filter. */
export function statusToIsActive(status: string): boolean | undefined {
  if (status === ROOM_STATUS.active) return true;
  if (status === ROOM_STATUS.inactive) return false;
  return undefined;
}

/** The type filter -> `room_type`: `all` is no filter. */
export function typeFilterToRoomType(type: string): RoomType | undefined {
  return type === FILTER_ALL ? undefined : (type as RoomType);
}

/** Building and floor shown as one place, e.g. "Science block · 2". */
export function roomLocation(record: Pick<RoomRecord, "building" | "floor">): string {
  return [record.building, record.floor].filter(Boolean).join(" · ");
}

export function defaultRoomFormValues(): RoomFormValues {
  return {
    campus_id: "",
    name: "",
    code: "",
    room_type: DEFAULT_ROOM_TYPE,
    capacity: "",
    building: "",
    floor: "",
    is_active: true,
  };
}

export function recordToRoomFormValues(record: RoomRecord): RoomFormValues {
  return {
    campus_id: record.campus_id,
    name: record.name,
    code: record.code,
    room_type: record.room_type ?? DEFAULT_ROOM_TYPE,
    capacity: record.capacity == null ? "" : String(record.capacity),
    building: record.building ?? "",
    floor: record.floor ?? "",
    is_active: record.is_active ?? true,
  };
}

/** Trimmed, with a blank as `null`, which clears a stored value. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Form values -> the service input. Every field is editable, so create and edit send the
 * same body. */
export function buildRoomInput(values: RoomFormValues): RoomInput {
  const capacity = values.capacity.trim();
  return {
    campusId: values.campus_id,
    name: values.name.trim(),
    code: values.code.trim(),
    roomType: values.room_type,
    capacity: capacity === "" ? null : Number(capacity),
    building: blankToNull(values.building),
    floor: blankToNull(values.floor),
    isActive: values.is_active,
  };
}
