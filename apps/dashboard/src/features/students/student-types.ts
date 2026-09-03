/**
 * Hand-declared wire types for the students API, matching the naming
 * convention every other feature in this app uses (see
 * dashboard-summary.tsx's DashboardStats): snake_case fields, no import of the
 * generated `ApiSchemas`/`paths` types. `packages/api-client`'s resource layer
 * (`students.list()`-style calls) will replace this once it ships.
 */

export type StudentGender = "male" | "female" | "other" | "unspecified";

export type StudentStatus = "active" | "suspended" | "transferred" | "withdrawn" | "graduated";

export interface StudentAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

/** Shared by the list and detail responses. `medical_notes` is present only when the
 * server chose to include it (see docs/03-modules/student-management.md §11 restricted
 * visibility) — its ABSENCE, not a null value, is the signal that it was withheld. */
export interface StudentRecord {
  id: string;
  admission_number: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: string;
  gender: StudentGender;
  photo_file_id: string | null;
  campus_id: string;
  house_id: string | null;
  status: StudentStatus;
  admission_date: string;
  blood_group: string | null;
  nationality: string | null;
  religion: string | null;
  previous_school: string | null;
  medical_notes?: string | null;
  address: StudentAddress | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StudentListFilters {
  campus_id?: string;
  house_id?: string;
  status?: StudentStatus;
  search?: string;
}
