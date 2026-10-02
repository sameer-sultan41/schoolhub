import type { ApiSchemas } from "@schoolhub/api-client";
import { fetchPage } from "@schoolhub/api-client";
import type { GenderValue, Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The students domain's API calls. Every consumer reaches these through
 * `Services.students.*` (see `@/services`) — never by importing this file directly and
 * never by importing `@schoolhub/api-client` directly.
 */

/** The generated wire shape — see
 * `docs/decisions/0017-generated-wire-types-for-new-domains.md`. */
export type StudentRecord = ApiSchemas["Student"];

export interface StudentsPageQuery {
  page: number;
  pageSize: number;
  search?: string;
  ordering?: string;
  status?: string;
  campusId?: string;
  houseId?: string;
}

export async function fetchStudentsPage(query: StudentsPageQuery): Promise<Page<StudentRecord>> {
  return fetchPage<StudentRecord>(apiClient, endpoints.students.list, {
    query: {
      page: query.page,
      page_size: query.pageSize,
      ...(query.search ? { search: query.search } : {}),
      ...(query.ordering ? { ordering: query.ordering } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.campusId ? { campus_id: query.campusId } : {}),
      ...(query.houseId ? { house_id: query.houseId } : {}),
    },
  });
}

export async function fetchStudentById(id: string): Promise<StudentRecord> {
  const { data } = await apiClient.get<StudentRecord>(endpoints.students.detail(id));
  return data;
}

/** camelCase, matching every other service input type in this codebase. Nullable
 * fields are `| null` so a caller can explicitly clear them on update. */
export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: GenderValue;
  campusId: string;
  admissionDate: string;
  preferredName?: string | null;
  houseId?: string | null;
  photoFileId?: string | null;
  bloodGroup?: string | null;
  nationality?: string | null;
  religion?: string | null;
  previousSchool?: string | null;
  medicalNotes?: string | null;
  address?: Record<string, unknown> | null;
}

export async function createStudent(input: CreateStudentInput): Promise<StudentRecord> {
  // `!== undefined`, not truthy — matching `updateStudent`'s own pattern below exactly.
  // `CreateStudentInput`'s optional fields are typed `| null`, same as
  // `UpdateStudentInput`'s, so a caller sending an explicit `null` must have it reach the
  // request body rather than being silently dropped the same way an empty string or `0`
  // would be under a truthy check.
  const body: Record<string, unknown> = {
    first_name: input.firstName,
    last_name: input.lastName,
    date_of_birth: input.dateOfBirth,
    gender: input.gender,
    campus_id: input.campusId,
    admission_date: input.admissionDate,
  };
  if (input.preferredName !== undefined) body.preferred_name = input.preferredName;
  if (input.houseId !== undefined) body.house_id = input.houseId;
  if (input.photoFileId !== undefined) body.photo_file_id = input.photoFileId;
  if (input.bloodGroup !== undefined) body.blood_group = input.bloodGroup;
  if (input.nationality !== undefined) body.nationality = input.nationality;
  if (input.religion !== undefined) body.religion = input.religion;
  if (input.previousSchool !== undefined) body.previous_school = input.previousSchool;
  if (input.medicalNotes !== undefined) body.medical_notes = input.medicalNotes;
  if (input.address !== undefined) body.address = input.address;
  const { data } = await apiClient.post<StudentRecord>(endpoints.students.list, body);
  return data;
}

export type UpdateStudentInput = Partial<CreateStudentInput>;

export async function updateStudent(id: string, input: UpdateStudentInput): Promise<StudentRecord> {
  const body: Record<string, unknown> = {};
  if (input.firstName !== undefined) body.first_name = input.firstName;
  if (input.lastName !== undefined) body.last_name = input.lastName;
  if (input.dateOfBirth !== undefined) body.date_of_birth = input.dateOfBirth;
  if (input.gender !== undefined) body.gender = input.gender;
  if (input.campusId !== undefined) body.campus_id = input.campusId;
  if (input.admissionDate !== undefined) body.admission_date = input.admissionDate;
  if (input.preferredName !== undefined) body.preferred_name = input.preferredName;
  if (input.houseId !== undefined) body.house_id = input.houseId;
  if (input.photoFileId !== undefined) body.photo_file_id = input.photoFileId;
  if (input.bloodGroup !== undefined) body.blood_group = input.bloodGroup;
  if (input.nationality !== undefined) body.nationality = input.nationality;
  if (input.religion !== undefined) body.religion = input.religion;
  if (input.previousSchool !== undefined) body.previous_school = input.previousSchool;
  if (input.medicalNotes !== undefined) body.medical_notes = input.medicalNotes;
  if (input.address !== undefined) body.address = input.address;
  const { data } = await apiClient.patch<StudentRecord>(endpoints.students.detail(id), body);
  return data;
}

export interface WithdrawStudentInput {
  reason: string;
  effectiveDate: string;
}

/** `waiveClearance` is always `false` this phase (Global Constraints). `idempotencyKey`:
 * the caller generates one per dialog-open and resends it on retry. */
export async function withdrawStudent(
  id: string,
  input: WithdrawStudentInput,
  idempotencyKey: string,
): Promise<StudentRecord> {
  const { data } = await apiClient.post<StudentRecord>(
    endpoints.students.withdraw(id),
    { reason: input.reason, effective_date: input.effectiveDate, waive_clearance: false },
    { idempotencyKey },
  );
  return data;
}
