import { ApiError } from "@schoolhub/api-client";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ExamRecord } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import {
  OTHER_RESULT_ID,
  OTHER_SECTION_ID,
  resultRecord,
} from "@/services/modules/exam-results/__tests__/exam-results-fixtures";
import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import { renderWithProviders } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import { ResultsTab } from "../results-tab";

/** Shared setup for the Results tab's tests; each file keeps its own `jest.mock` calls. */

export const RESULT_VIEW = "exams.result.view";

/** Ali Raza's result, awaiting approval (the fixture's default). */
export const PENDING = resultRecord();
/** Sara Khan's result in section B, withheld before publication. */
export const WITHHELD = resultRecord({
  id: OTHER_RESULT_ID,
  student_name: "Sara Khan",
  admission_number: "ADM-002",
  section_id: OTHER_SECTION_ID,
  section_name: "B",
  percentage: "61.00",
  grade: "C",
  gpa: null,
  rank_in_section: 1,
  outcome: "withheld",
});

/** An exam whose results were processed and await approval. */
export const PROCESSED_EXAM = examRecord({ status: "processing" });

/** The server's 409 while marks are outstanding (`processing.assert_ready_to_process`). */
export const OUTSTANDING =
  "Marks are still outstanding, so results cannot be processed: Mathematics (2 student(s)).";
/** The server's 422 when the latest processor approves (`assert_approver_is_not_the_processor`). */
export const OWN_RUN_REFUSAL =
  "You ran the processing for this exam, so you cannot also approve it. Results need a second pair of eyes (§4).";

export function apiError(status: number, code: string, message: string, field?: string) {
  return new ApiError({
    code,
    message,
    status,
    url: "/exams/x:process-results",
    details: field ? [{ field, issue: message }] : [],
  });
}

/** A finished processing job (`process_results_task`'s result). */
export function processJob(overrides: Partial<BackgroundJobRecord> = {}): BackgroundJobRecord {
  return {
    id: "job-1",
    job_type: "exams.process-results",
    status: "succeeded",
    progress: 100,
    result: { created: 0, updated: 2, students: 2 },
    error: null,
    ...overrides,
  };
}

/** Mounts the tab and waits for the signed-in user, so an absent control is really absent. */
export async function renderTab(exam: ExamRecord = PROCESSED_EXAM) {
  renderWithProviders(
    <>
      <UserLoaded />
      <ResultsTab exam={exam} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}
