import { uuid } from "@/data/factories";
import { fail, noContent, ok, type MockResponse } from "../envelope";
import type { MockApi } from "../router";
import type { Campus, Department, House } from "./school-organization";

/**
 * The School module's writes, `/school-settings` and `/holiday-calendar`, registered by
 * `schoolOrganizationModule` over the same lists its reads serve. Each refusal copies the
 * server's sentence (L5): `services.assert_deletable`, the settings serializer and service,
 * and `HolidayCalendarSerializer`.
 */

/** The generated `SchoolSettings` wire shape. */
export interface SchoolSettings {
  name: string;
  logo_file_id: string | null;
  logo_url: string | null;
  branding: Record<string, unknown>;
  academic: Record<string, unknown>;
  timezone: string;
  locale: string;
  currency: string;
}

export function buildSchoolSettings(overrides: Partial<SchoolSettings> = {}): SchoolSettings {
  return {
    name: "City School",
    logo_file_id: null,
    logo_url: null,
    branding: { primary_color: "#1E88E5" },
    academic: {},
    timezone: "Asia/Karachi",
    locale: "en",
    currency: "PKR",
    ...overrides,
  };
}

/** One stored holiday, as `GET /holiday-calendar` answers it. */
export interface Holiday {
  name: string;
  start_date: string;
  end_date: string;
  campus_id: string | null;
}

export interface HolidayCalendar {
  working_days: number[];
  holidays: Holiday[];
}

/** `calendar.DEFAULT_WORKING_DAYS`: Monday to Friday. */
export function buildHolidayCalendar(overrides: Partial<HolidayCalendar> = {}): HolidayCalendar {
  return { working_days: [0, 1, 2, 3, 4], holidays: [], ...overrides };
}

export interface SchoolSetupState {
  campuses: Campus[];
  departments: Department[];
  houses: House[];
  settings: SchoolSettings;
  calendar: HolidayCalendar;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function validation(field: string, issue: string): MockResponse {
  return fail(400, issue, { details: [{ field, issue }] });
}

/** `services.assert_deletable`'s 422, naming the relations that still point at the row. */
export function referenced(relations: string[]): MockResponse {
  const message =
    `Cannot delete while dependent records exist (${relations.sort().join(", ")}). ` +
    "Deactivate it instead.";
  return fail(422, message, {
    code: "domain_rule_violation",
    details: [{ field: "non_field", issue: message }],
  });
}

export function removeRow(rows: { id: string }[], rowId: string | undefined): MockResponse {
  const index = rows.findIndex((row) => row.id === rowId);
  if (index === -1) return fail(404, "Not found.");
  rows.splice(index, 1);
  return noContent();
}

export function requireName(body: { name?: string | null } | null): MockResponse | undefined {
  return body?.name?.trim() ? undefined : validation("name", "This field is required.");
}

/** Promoting a primary campus demotes the incumbent, as `clear_primary_campus` does. */
function demoteOtherPrimaries(campuses: Campus[], keep: Campus) {
  if (!keep.is_primary) return;
  for (const campus of campuses) if (campus !== keep) campus.is_primary = false;
}

function registerCampusWrites(api: MockApi, { campuses, departments }: SchoolSetupState) {
  api.post("/campuses", (request) => {
    const body = request.json() as Partial<Campus> | null;
    const refusal = requireName(body);
    if (refusal) return refusal;
    // id last: the server assigns it, so a client-supplied one must not win.
    const created: Campus = {
      address: null,
      phone: null,
      email: null,
      timezone: null,
      is_primary: false,
      is_active: true,
      code: "",
      name: "",
      ...body,
      id: uuid(),
    };
    campuses.push(created);
    demoteOtherPrimaries(campuses, created);
    return ok(created, { status: 201 });
  });

  api.patch("/campuses/:rowId", (request) => {
    const match = campuses.find((row) => row.id === request.params["rowId"]);
    if (!match) return fail(404, "Not found.");
    Object.assign(match, request.json() as Partial<Campus>);
    demoteOtherPrimaries(campuses, match);
    return ok(match);
  });

  api.delete("/campuses/:rowId", (request) => {
    const rowId = request.params["rowId"];
    if (departments.some((row) => row.campus_id === rowId)) return referenced(["departments"]);
    return removeRow(campuses, rowId);
  });
}

function registerDepartmentWrites(api: MockApi, { departments }: SchoolSetupState) {
  api.post("/departments", (request) => {
    const body = request.json() as Partial<Department> | null;
    const refusal = requireName(body);
    if (refusal) return refusal;
    const created: Department = {
      code: "",
      name: "",
      department_type: "academic",
      campus_id: null,
      description: null,
      is_active: true,
      ...body,
      id: uuid(),
    };
    departments.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/departments/:rowId", (request) => {
    const match = departments.find((row) => row.id === request.params["rowId"]);
    if (!match) return fail(404, "Not found.");
    Object.assign(match, request.json() as Partial<Department>);
    return ok(match);
  });

  api.delete("/departments/:rowId", (request) => removeRow(departments, request.params["rowId"]));
}

function registerHouseWrites(api: MockApi, { houses }: SchoolSetupState) {
  api.post("/houses", (request) => {
    const body = request.json() as Partial<House> | null;
    const refusal = requireName(body);
    if (refusal) return refusal;
    const created: House = {
      name: "",
      code: null,
      color: null,
      motto: null,
      is_active: true,
      ...body,
      id: uuid(),
    };
    houses.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/houses/:rowId", (request) => {
    const match = houses.find((row) => row.id === request.params["rowId"]);
    if (!match) return fail(404, "Not found.");
    Object.assign(match, request.json() as Partial<House>);
    return ok(match);
  });

  api.delete("/houses/:rowId", (request) => removeRow(houses, request.params["rowId"]));
}

/** `GET/PATCH /school-settings`: branding merges key by key; slug and status are not fields. */
function registerSettings(api: MockApi, { settings }: SchoolSetupState) {
  api.get("/school-settings", () => ok(settings));

  api.patch("/school-settings", (request) => {
    const body = (request.json() as Partial<SchoolSettings> | null) ?? {};
    const color = body.branding?.["primary_color"];
    const isHex = typeof color === "string" && HEX_COLOR.test(color);
    if (color !== undefined && color !== null && !isHex) {
      return validation("branding.primary_color", "Enter a hex colour such as #1E88E5.");
    }
    if (body.name !== undefined && !body.name.trim()) {
      return validation("name", "This field may not be blank.");
    }
    const { branding, ...rest } = body;
    for (const key of ["name", "logo_file_id", "timezone", "locale", "currency"] as const) {
      if (key in rest) Object.assign(settings, { [key]: rest[key] });
    }
    if (body.currency) settings.currency = body.currency.toUpperCase();
    if (branding) settings.branding = { ...settings.branding, ...branding };
    return ok(settings);
  });
}

/** `GET/PUT /holiday-calendar`: `PUT` replaces each list it names. */
function registerCalendar(api: MockApi, { calendar }: SchoolSetupState) {
  api.get("/holiday-calendar", () => ok(calendar));

  api.on("PUT", "/holiday-calendar", (request) => {
    const body = (request.json() as Partial<HolidayCalendar> | null) ?? {};
    if (body.working_days !== undefined) {
      if (body.working_days.length === 0) {
        return validation("working_days", "A school must operate on at least one weekday.");
      }
      calendar.working_days = [...new Set(body.working_days)].sort((a, b) => a - b);
    }
    if (body.holidays !== undefined) {
      const holidays = body.holidays.map((entry) => ({
        ...entry,
        end_date: entry.end_date || entry.start_date,
      }));
      const backwards = holidays.findIndex((entry) => entry.end_date < entry.start_date);
      if (backwards !== -1) {
        return validation(
          `holidays.${String(backwards)}.end_date`,
          "A holiday cannot end before it starts.",
        );
      }
      calendar.holidays = holidays;
    }
    return ok(calendar);
  });
}

export function registerSchoolSetup(api: MockApi, state: SchoolSetupState) {
  registerCampusWrites(api, state);
  registerDepartmentWrites(api, state);
  registerHouseWrites(api, state);
  registerSettings(api, state);
  registerCalendar(api, state);
}
