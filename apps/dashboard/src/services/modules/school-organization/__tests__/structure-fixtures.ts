import type { Page } from "@schoolhub/types";

import type { CampusRecord, DepartmentRecord, HouseRecord } from "@/services";
import { CAMPUS_ID } from "@/test-fixtures/academics";

// UUID-shaped: the URL and the form drop an id that isn't one.
export const DEPARTMENT_ID = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
export const HOUSE_ID = "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f";

const TIMES = { created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" };

/** The main campus, primary and active; override what a test needs. */
export function campusRecord(overrides: Partial<CampusRecord> = {}): CampusRecord {
  return {
    id: CAMPUS_ID,
    name: "Main Campus",
    code: "MAIN",
    address: null,
    phone: "+92 21 1234567",
    email: "main@cityschool.test",
    timezone: null,
    head_staff_id: null,
    is_primary: true,
    is_active: true,
    ...TIMES,
    ...overrides,
  };
}

/** The Science department, academic, spanning every campus. */
export function departmentRecord(overrides: Partial<DepartmentRecord> = {}): DepartmentRecord {
  return {
    id: DEPARTMENT_ID,
    name: "Science",
    code: "SCI",
    department_type: "academic",
    campus_id: null,
    head_staff_id: null,
    description: null,
    is_active: true,
    ...TIMES,
    ...overrides,
  };
}

/** Red House, with a colour and a motto. */
export function houseRecord(overrides: Partial<HouseRecord> = {}): HouseRecord {
  return {
    id: HOUSE_ID,
    name: "Red House",
    code: "RED",
    color: "#D32F2F",
    motto: "Courage first",
    house_master_staff_id: null,
    is_active: true,
    ...TIMES,
    ...overrides,
  };
}

export function structurePage<T>(items: T[]): Page<T> {
  return {
    items,
    pagination: { page: 1, page_size: 10, total_count: items.length, total_pages: 1 },
  };
}

/** What `services.assert_deletable` answers for a campus still in use, word for word. */
export const REFERENCED =
  "Cannot delete while dependent records exist (departments, rooms). Deactivate it instead.";
