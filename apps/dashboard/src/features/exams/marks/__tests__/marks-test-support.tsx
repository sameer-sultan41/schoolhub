import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ExamRecord } from "@/services";
import { EXAM_SUBJECT_ID, SECTION_ID } from "@/services/modules/marks/__tests__/marks-fixtures";
import { EXAM_ID, examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import { renderWithProviders, setUrl } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import { asUser } from "../../__tests__/exams-test-support";
import { MarksTab } from "../marks-tab";

/** Shared setup for the Marks tab's tests; each file keeps its own `jest.mock` calls. */

export const MARKS_VIEW = "exams.marks.view";
export const MARKS_CREATE = "exams.marks.create";
export const MARKS_LOCK = "exams.marks.lock";
export const MARKS_IMPORT = "exams.marks.import";

/** An exam taking marks. */
export const MARKS_EXAM = examRecord({ status: "marks_entry" });

/** Signs in as a teacher who may read and enter marks. */
export function asMarker() {
  asUser(MARKS_VIEW, MARKS_CREATE);
}

/** The tab's address with the grid of `subject` and `section` open. */
export function gridUrl(subject = EXAM_SUBJECT_ID, section = SECTION_ID) {
  return `/exams/${EXAM_ID}?tab=marks&subject=${subject}&section=${section}`;
}

/** Mounts the tab at `url` and waits for the signed-in user, so an absent control is really
 * absent. */
export async function renderMarksTab(
  url = `/exams/${EXAM_ID}?tab=marks`,
  exam: ExamRecord = MARKS_EXAM,
) {
  setUrl(url);
  renderWithProviders(
    <>
      <UserLoaded />
      <MarksTab exam={exam} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}
