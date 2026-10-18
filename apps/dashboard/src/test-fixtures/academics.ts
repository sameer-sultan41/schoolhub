import type { AcademicSessionSummary } from "@/services";

/**
 * Fixtures the Academics tests share: the academic sessions and the ids of the records a
 * session's screens work on (a class, a subject, a campus). Import them from here, not from
 * another module's `__tests__/`. A module's own record builders stay beside its tests.
 */

// Every id is UUID-shaped: the URL and the form both drop a value that isn't one.
export const SESSION_ID = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
export const PLANNED_SESSION_ID = "1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e";
export const CLOSED_SESSION_ID = "2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
export const UNKNOWN_SESSION_ID = "3d4e5f6a-7b8c-4d9e-9f0a-1b2c3d4e5f6a";
export const CLASS_ID = "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b";
export const SUBJECT_ID = "5f6a7b8c-9d0e-4f1a-9b2c-3d4e5f6a7b8c";
export const CAMPUS_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";

export const CURRENT_SESSION: AcademicSessionSummary = {
  id: SESSION_ID,
  name: "2026-27",
  status: "active",
  is_current: true,
};
export const PLANNED_SESSION: AcademicSessionSummary = {
  id: PLANNED_SESSION_ID,
  name: "2027-28",
  status: "planned",
  is_current: false,
};
export const CLOSED_SESSION: AcademicSessionSummary = {
  id: CLOSED_SESSION_ID,
  name: "2025-26",
  status: "closed",
  is_current: false,
};
export const SESSIONS = [CURRENT_SESSION, PLANNED_SESSION, CLOSED_SESSION];
