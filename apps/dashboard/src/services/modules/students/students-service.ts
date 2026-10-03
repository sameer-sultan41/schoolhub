import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toStudentBody, toStudentsQueryParams } from "./students-helper";
import type {
  CreateStudentInput,
  StudentRecord,
  StudentsPageQuery,
  UpdateStudentInput,
  WithdrawStudentInput,
} from "./students-type";

/**
 * The students domain's API calls. Every consumer reaches these through
 * `Services.students.*` (see `@/services`) — never by importing this file directly and
 * never by importing `@schoolhub/api-client` directly.
 */

export type {
  CreateStudentInput,
  StudentRecord,
  StudentsPageQuery,
  UpdateStudentInput,
  WithdrawStudentInput,
} from "./students-type";

export async function fetchStudentsPage(query: StudentsPageQuery): Promise<Page<StudentRecord>> {
  return fetchPage<StudentRecord>(apiClient, endpoints.students.list, {
    query: toStudentsQueryParams(query),
  });
}

export async function fetchStudentById(id: string): Promise<StudentRecord> {
  const { data } = await apiClient.get<StudentRecord>(endpoints.students.detail(id));
  return data;
}

export async function createStudent(input: CreateStudentInput): Promise<StudentRecord> {
  const { data } = await apiClient.post<StudentRecord>(
    endpoints.students.list,
    toStudentBody(input),
  );
  return data;
}

export async function updateStudent(id: string, input: UpdateStudentInput): Promise<StudentRecord> {
  const { data } = await apiClient.patch<StudentRecord>(
    endpoints.students.detail(id),
    toStudentBody(input),
  );
  return data;
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
