/**
 * Hand-declared wire types for the staff API, matching the naming convention
 * every other feature in this app uses (see student-types.ts): snake_case
 * fields, no import of the generated `ApiSchemas`/`paths` types — the staff
 * paths are not yet in packages/api-client/src/schema.d.ts.
 */

export type StaffGender = "male" | "female" | "other" | "unspecified";

export type StaffType = "teaching" | "non_teaching";

export type EmploymentType = "full_time" | "part_time" | "contract" | "visiting";

export type EmploymentStatus =
  "active" | "on_leave" | "suspended" | "resigned" | "retired" | "terminated";

export interface StaffAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

/** Mirrors apps.staff_management.serializers.StaffSerializer. employee_number is
 * server-generated on create and immutable after — see staff-form.tsx. */
export interface StaffRecord {
  id: string;
  employee_number: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  gender: StaffGender;
  date_of_birth: string | null;
  photo_file_id: string | null;
  staff_type: StaffType;
  campus_id: string;
  department_id: string | null;
  designation_id: string | null;
  reports_to_staff_id: string | null;
  employment_type: EmploymentType;
  employment_status: EmploymentStatus;
  joining_date: string;
  exit_date: string | null;
  exit_reason: string | null;
  email: string | null;
  phone: string;
  national_id: string | null;
  public_bio: string | null;
  address: StaffAddress | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StaffListFilters {
  campus_id?: string;
  department_id?: string;
  designation_id?: string;
  staff_type?: StaffType;
  employment_status?: EmploymentStatus;
  search?: string;
}

/** Mirrors apps.staff_management.serializers.DesignationSerializer. */
export interface DesignationRecord {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  level: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type QualificationType = "degree" | "diploma" | "certification" | "training" | "license";

export type VerificationStatus = "pending" | "verified" | "rejected";

/** Mirrors apps.staff_management.serializers.StaffQualificationSerializer.
 * verification_status/verified_by/verified_at move only through :verify. */
export interface StaffQualificationRecord {
  id: string;
  staff_id: string;
  qualification_type: QualificationType;
  title: string;
  institution: string | null;
  field_of_study: string | null;
  year_awarded: number | null;
  grade: string | null;
  document_file_id: string | null;
  verification_status: VerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Mirrors apps.staff_management.serializers.StaffDocumentSerializer. */
export interface StaffDocumentRecord {
  id: string;
  staff_id: string;
  file_id: string;
  document_type: string;
  title: string;
  notes: string | null;
  verification_status: VerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}
