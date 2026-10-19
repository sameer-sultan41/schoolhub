import { id } from "@/data/factories";
import { fail, noContent, ok } from "../envelope";
import { compareValues, nameOf, pageOf, type Named } from "../list";
import type { MockModule } from "../router";

/** The generated `Period` wire shape. `start_time`/`end_time` are `HH:MM:SS`, as the API
 * serializes a `TimeField`. */
export interface Period {
  id: string;
  campus_id: string | null;
  campus_name: string | null;
  name: string;
  sequence: number;
  start_time: string;
  end_time: string;
  is_break: boolean;
  weekdays: number[] | null;
  created_at: string;
  updated_at: string;
}

/** The generated `Room` wire shape. */
export interface Room {
  id: string;
  campus_id: string;
  campus_name: string;
  name: string;
  code: string;
  room_type: string;
  capacity: number | null;
  building: string | null;
  floor: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function buildPeriod(overrides: Partial<Period> = {}): Period {
  return {
    id: id("period"),
    campus_id: null,
    campus_name: null,
    name: "Period 1",
    sequence: 1,
    start_time: "08:00:00",
    end_time: "08:45:00",
    is_break: false,
    weekdays: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

export function buildRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: id("room"),
    campus_id: "",
    campus_name: "",
    name: "Room 101",
    code: "R-101",
    room_type: "classroom",
    capacity: 40,
    building: null,
    floor: null,
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

export interface TimetableSetupOptions {
  periods?: Period[];
  rooms?: Room[];
  /** The campuses `schoolOrganizationModule` serves, for a written row's `campus_name`. */
  campuses?: Named[];
}

/** `HH:MM` from the form, `HH:MM:SS` on the wire. */
function toWireTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

/**
 * `/periods` and `/rooms` — list (with the filters and orderings the screens send), create,
 * update and delete.
 *
 * Mirrors the one rule the screens surface from the server: a period that overlaps another
 * at its campus, or a tenant-wide one, is a 422 on `start_time` with the same wording as
 * `apps/timetable/periods/services.assert_period_does_not_overlap`.
 */
export function timetableSetupModule(options: TimetableSetupOptions = {}): MockModule {
  return (api) => {
    const periods = [...(options.periods ?? [])];
    const rooms = [...(options.rooms ?? [])];
    const campuses = options.campuses ?? [];

    api.get("/periods", (request) => {
      const params = request.searchParams;
      const forCampus = params.get("for_campus");
      const campusId = params.get("campus_id");
      const isBreak = params.get("is_break");
      const search = params.get("search")?.toLowerCase();
      const matching = periods.filter(
        (row) =>
          (!forCampus || row.campus_id === forCampus || row.campus_id === null) &&
          (!campusId || row.campus_id === campusId) &&
          (isBreak === null || String(row.is_break) === isBreak) &&
          (!search || row.name.toLowerCase().includes(search)),
      );
      return pageOf(ordered(matching, params.get("ordering") ?? "sequence"), params);
    });

    api.post("/periods", (request) => {
      const body = request.json() as Partial<Period> | null;
      if (!body) return fail(400, "Validation failed.");
      const created = buildPeriod({ ...withWireTimes(body), campus_name: null });
      created.campus_name = nameOf(campuses, created.campus_id);
      const clash = overlapResponse(periods, created);
      if (clash) return clash;
      periods.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/periods/:rowId", (request) => {
      const match = periods.find((row) => row.id === request.params["rowId"]);
      if (!match) return fail(404, "Not found.");
      const next = { ...match, ...withWireTimes(request.json() as Partial<Period>) };
      const clash = overlapResponse(periods, next);
      if (clash) return clash;
      Object.assign(match, next, {
        campus_name: nameOf(campuses, next.campus_id),
        updated_at: "2026-09-02T00:00:00Z",
      });
      return ok(match);
    });

    api.delete("/periods/:rowId", (request) => removeFrom(periods, request.params["rowId"]));

    api.get("/rooms", (request) => {
      const params = request.searchParams;
      const campusId = params.get("campus_id");
      const roomType = params.get("room_type");
      const isActive = params.get("is_active");
      const search = params.get("search")?.toLowerCase();
      const matching = rooms.filter(
        (row) =>
          (!campusId || row.campus_id === campusId) &&
          (!roomType || row.room_type === roomType) &&
          (isActive === null || String(row.is_active) === isActive) &&
          (!search ||
            `${row.name} ${row.code} ${row.building ?? ""}`.toLowerCase().includes(search)),
      );
      return pageOf(ordered(matching, params.get("ordering") ?? "code"), params);
    });

    api.post("/rooms", (request) => {
      const body = request.json() as Partial<Room> | null;
      if (!body) return fail(400, "Validation failed.");
      const created = buildRoom(body);
      created.campus_name = nameOf(campuses, created.campus_id) ?? "";
      rooms.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/rooms/:rowId", (request) => {
      const match = rooms.find((row) => row.id === request.params["rowId"]);
      if (!match) return fail(404, "Not found.");
      Object.assign(match, request.json() as Partial<Room>, {
        updated_at: "2026-09-02T00:00:00Z",
      });
      match.campus_name = nameOf(campuses, match.campus_id) ?? "";
      return ok(match);
    });

    api.delete("/rooms/:rowId", (request) => removeFrom(rooms, request.params["rowId"]));
  };
}

function withWireTimes(body: Partial<Period>): Partial<Period> {
  return {
    ...body,
    ...(body.start_time ? { start_time: toWireTime(body.start_time) } : {}),
    ...(body.end_time ? { end_time: toWireTime(body.end_time) } : {}),
  };
}

function overlapResponse(periods: Period[], candidate: Period) {
  const clash = periods.find(
    (row) =>
      row.id !== candidate.id &&
      (row.campus_id === candidate.campus_id || row.campus_id === null) &&
      row.start_time < candidate.end_time &&
      row.end_time > candidate.start_time,
  );
  if (!clash) return undefined;
  const issue =
    `This overlaps '${clash.name}' (${clash.start_time}-${clash.end_time}). ` +
    "Periods in one day template may not overlap.";
  return fail(422, issue, {
    code: "domain_rule_violation",
    details: [{ field: "start_time", issue }],
  });
}

function removeFrom(rows: { id: string }[], rowId: string | undefined) {
  const index = rows.findIndex((row) => row.id === rowId);
  if (index === -1) return fail(404, "Not found.");
  rows.splice(index, 1);
  return noContent();
}

function ordered<T>(rows: T[], ordering: string): T[] {
  const direction = ordering.startsWith("-") ? -1 : 1;
  const field = ordering.replace(/^-/, "") as keyof T;
  return [...rows].sort((a, b) => direction * compareValues(a[field], b[field]));
}
