import { collectPages, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import { toBulkMarksEntryBody, toMarksGridMeta } from "./marks-helper";
import type {
  BulkMarksEntryInput,
  BulkMarksEntryResult,
  MarksGrid,
  MarksGridEntry,
  MarksGridQuery,
  MarksLockResult,
  MarksProgressRow,
  MarksRecord,
  MarksUnlockResult,
} from "./marks-type";

/** The marks API calls (`/marks/grid`, `/marks:bulk-entry`, `/marks-imports`, an exam's
 * `marks-progress` and an exam-subject's lock), reached through `Services.marks.*`. */

/** One section's grid for one exam-subject: the roll with its marks, and whether it is writable.
 * A section the caller may not enter is a 404. */
export async function fetchGrid(query: MarksGridQuery): Promise<MarksGrid> {
  const { data, meta } = await apiClient.get<MarksGridEntry[]>(endpoints.marks.grid, {
    query: { exam_subject_id: query.examSubjectId, section_id: query.sectionId },
  });
  return { entries: data, meta: toMarksGridMeta(meta) };
}

/** Saves the whole grid at once; any refused row refuses it all (a 422 with `error.meta.rows`).
 * `idempotencyKey` makes a re-send replay the first answer. */
export async function bulkEntry(
  input: BulkMarksEntryInput,
  idempotencyKey: string,
): Promise<BulkMarksEntryResult> {
  const { data } = await apiClient.post<BulkMarksEntryResult>(
    endpoints.marks.bulkEntry,
    toBulkMarksEntryBody(input),
    { idempotencyKey },
  );
  return data;
}

/** Every subject mark one student has in one exam (the results detail sheet). The list is
 * cursor-paginated, so this follows the cursor; the caller's record scope decides what it sees. */
export async function fetchStudentMarks(examId: string, studentId: string): Promise<MarksRecord[]> {
  return collectPages<MarksRecord>(apiClient, endpoints.marks.list, {
    query: { exam_id: examId, student_id: studentId, page_size: MAX_PAGE_SIZE },
  });
}

/** One row per (exam-subject, section) the caller may enter, with its counts and lock. */
export async function fetchProgress(examId: string): Promise<MarksProgressRow[]> {
  const { data } = await apiClient.get<MarksProgressRow[]>(endpoints.exams.marksProgress(examId));
  return data;
}

/** Locks an exam-subject's marks in every section; a retry answers `already_locked`. */
export async function lockMarks(examSubjectId: string): Promise<MarksLockResult> {
  const { data } = await apiClient.post<MarksLockResult>(
    endpoints.examSubjects.lockMarks(examSubjectId),
  );
  return data;
}

/** Reopens a locked exam-subject (audited); a retry answers `already_unlocked`. */
export async function unlockMarks(examSubjectId: string): Promise<MarksUnlockResult> {
  const { data } = await apiClient.post<MarksUnlockResult>(
    endpoints.examSubjects.unlockMarks(examSubjectId),
  );
  return data;
}

/** `POST /marks-imports` (multipart) -> `202` + job: a CSV or .xlsx sheet for one exam-subject.
 * Bad rows come back in the job's `ImportJobResult`. */
export async function importMarks(examSubjectId: string, file: File): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("file", file);
  body.append("exam_subject_id", examSubjectId);
  const { data } = await apiClient.post<JobAccepted>(endpoints.marks.imports, body);
  return { jobId: data.job_id };
}
