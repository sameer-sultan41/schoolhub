import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { RELATION_PAGE_SIZE } from "./students-constant";
import { toStudentBody, toStudentsQueryParams } from "./students-helper";
import type {
  AddEmergencyContactInput,
  CreateStudentInput,
  DocumentVerificationDecision,
  EmergencyContactRecord,
  StudentDocumentRecord,
  StudentRecord,
  StudentsPageQuery,
  UpdateStudentInput,
  UploadDocumentInput,
  WithdrawStudentInput,
} from "./students-type";

/**
 * The students domain's API calls. Every consumer reaches these through
 * `Services.students.*` (see `@/services`) — never by importing this file directly and
 * never by importing `@schoolhub/api-client` directly.
 */

export type {
  AddEmergencyContactInput,
  CreateStudentInput,
  DocumentVerificationDecision,
  EmergencyContactRecord,
  StudentDocumentRecord,
  StudentRecord,
  StudentsPageQuery,
  UpdateStudentInput,
  UploadDocumentInput,
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

export async function fetchEmergencyContacts(studentId: string): Promise<EmergencyContactRecord[]> {
  const { items } = await fetchPage<EmergencyContactRecord>(
    apiClient,
    endpoints.students.emergencyContacts(studentId),
    { query: { ordering: "priority", page_size: RELATION_PAGE_SIZE } },
  );
  return items;
}

export async function addEmergencyContact(
  studentId: string,
  input: AddEmergencyContactInput,
): Promise<EmergencyContactRecord> {
  const { data } = await apiClient.post<EmergencyContactRecord>(
    endpoints.students.emergencyContacts(studentId),
    {
      name: input.name,
      relationship: input.relationship,
      phone: input.phone,
      ...(input.altPhone ? { alt_phone: input.altPhone } : {}),
      priority: input.priority,
      ...(input.notes ? { notes: input.notes } : {}),
    },
  );
  return data;
}

export async function fetchDocuments(studentId: string): Promise<StudentDocumentRecord[]> {
  const { items } = await fetchPage<StudentDocumentRecord>(
    apiClient,
    endpoints.students.documents(studentId),
    { query: { page_size: RELATION_PAGE_SIZE } },
  );
  return items;
}

export async function uploadDocumentRecord(
  studentId: string,
  input: UploadDocumentInput,
): Promise<StudentDocumentRecord> {
  const { data } = await apiClient.post<StudentDocumentRecord>(
    endpoints.students.documents(studentId),
    {
      file_id: input.fileId,
      document_type: input.documentType,
      title: input.title,
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
    },
  );
  return data;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await apiClient.delete(endpoints.studentDocuments.detail(documentId));
}

export async function verifyDocument(
  documentId: string,
  decision: DocumentVerificationDecision,
): Promise<StudentDocumentRecord> {
  const { data } = await apiClient.post<StudentDocumentRecord>(
    endpoints.studentDocuments.verify(documentId),
    { decision },
  );
  return data;
}

/** Task 1's own `students.document.view`-gated action — distinct from the generic
 * `Services.jobs.fetchFileDownloadUrl`, which stays `/staff`'s export download path. */
export async function getDocumentDownloadUrl(documentId: string): Promise<string> {
  const { data } = await apiClient.post<{ download_url: string }>(
    endpoints.studentDocuments.download(documentId),
  );
  return data.download_url;
}
