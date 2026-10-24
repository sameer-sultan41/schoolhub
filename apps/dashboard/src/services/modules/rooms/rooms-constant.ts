import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type { RoomInput, RoomPageQuery, RoomType } from "./rooms-type";

/** The rooms module's constants. */

/** The query-key module every room read lives under; a room write invalidates it. */
export const ROOMS_QUERY_MODULE = "rooms";
export const ROOMS_LIST_RESOURCE = "list";
/** One campus's rooms in service: the grid cell's room picker. */
export const ROOMS_ACTIVE_RESOURCE = "active";

/** Every room type, keyed so the compiler checks the set against the generated enum: a type
 * the API adds or drops fails here rather than going missing from the picker. */
const ROOM_TYPE_SET: Record<RoomType, true> = {
  classroom: true,
  lab: true,
  library: true,
  auditorium: true,
  sports: true,
  office: true,
  other: true,
};
export const ROOM_TYPES = Object.keys(ROOM_TYPE_SET) as RoomType[];

/** A new room is a classroom unless said otherwise (the model's default). */
export const DEFAULT_ROOM_TYPE: RoomType = "classroom";

/** Column id -> the `?ordering=` field `/rooms` accepts. */
export const ROOMS_SORT_FIELD: Record<string, string> = {
  code: "code",
  name: "name",
  type: "room_type",
  capacity: "capacity",
  status: "is_active",
  campus: "campus_name",
};

export const ROOMS_SORTABLE_IDS = Object.keys(ROOMS_SORT_FIELD);

export const ROOMS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [{ id: "code", desc: false }];

/** The status filter: `all` omits the API filter, the others map to `is_active`. */
export const ROOM_STATUS = { all: FILTER_ALL, active: "active", inactive: "inactive" } as const;

const ROOM_STATUS_VALUES: readonly string[] = Object.values(ROOM_STATUS);
const ROOM_TYPE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...ROOM_TYPES];

/** The table's `actions` column id: hidden for a viewer with neither action. */
export const ROOMS_ACTIONS_COLUMN_ID = "actions";

/** The list's URL filters (`useDataGridUrlState`). */
export const ROOMS_URL_FILTERS = {
  campus: { default: "", isValid: isUuid },
  type: {
    default: FILTER_ALL,
    isValid: (value: string) => ROOM_TYPE_FILTER_VALUES.includes(value),
  },
  status: {
    default: ROOM_STATUS.all,
    isValid: (value: string) => ROOM_STATUS_VALUES.includes(value),
  },
};

/** The column limits (`timetable.models.Room`). */
export const ROOM_NAME_MAX = 80;
export const ROOM_CODE_MAX = 20;
export const ROOM_BUILDING_MAX = 80;
export const ROOM_FLOOR_MAX = 20;
/** A room must seat at least one (`RoomSerializer.validate_capacity`). */
export const ROOM_MIN_CAPACITY = 1;

/** camelCase `RoomInput` key -> the API's body key. */
export const ROOMS_BODY_FIELDS: ReadonlyArray<readonly [keyof RoomInput, string]> = [
  ["campusId", "campus_id"],
  ["name", "name"],
  ["code", "code"],
  ["roomType", "room_type"],
  ["capacity", "capacity"],
  ["building", "building"],
  ["floor", "floor"],
  ["isActive", "is_active"],
];

/** camelCase `RoomPageQuery` key -> the `/rooms` query param. */
export const ROOMS_QUERY_FIELDS: ReadonlyArray<readonly [keyof RoomPageQuery, string]> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["campusId", "campus_id"],
  ["roomType", "room_type"],
  ["isActive", "is_active"],
];

/** The fields a server error may name on the form; any other shows as the form's message. */
export const ROOMS_ERROR_FIELDS = [
  "campus_id",
  "name",
  "code",
  "room_type",
  "capacity",
  "building",
  "floor",
  "is_active",
] as const;
