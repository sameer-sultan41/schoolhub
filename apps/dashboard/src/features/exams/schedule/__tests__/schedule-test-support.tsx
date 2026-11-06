import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ExamRecord } from "@/services";
import {
  conflictRecord,
  OTHER_SITTING_ID,
  SITTING_ID,
  sittingRecord,
} from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";
import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import { renderWithProviders } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import { asUser } from "../../__tests__/exams-test-support";
import { ScheduleTab } from "../schedule-tab";

/** Shared setup for the Schedule tab's tests; each file keeps its own `jest.mock` calls (hoisting). */

export const SCHEDULE_VIEW = "exams.schedule.view";
export const SCHEDULE_CREATE = "exams.schedule.create";
export const SCHEDULE_UPDATE = "exams.schedule.update";

/** A second sitting (English, section B, afternoon) beside the default one. */
export const SECOND = sittingRecord({
  id: OTHER_SITTING_ID,
  subject_name: "English",
  section_name: "B",
  start_time: "13:00:00",
  end_time: "14:00:00",
  room_name: null,
  invigilator_name: null,
});
/** A hard clash naming both sittings, and a soft one naming the second. */
export const HARD = conflictRecord({ schedule_ids: [SITTING_ID, OTHER_SITTING_ID] });
export const SOFT = conflictRecord({
  type: "room_over_capacity",
  severity: "soft",
  schedule_ids: [OTHER_SITTING_ID],
  message: "Room 101 seats 30 and the section has 38.",
});

/** Signs in as someone who can view, add and change sittings. */
export function asScheduler() {
  asUser(SCHEDULE_VIEW, SCHEDULE_CREATE, SCHEDULE_UPDATE);
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: { field?: string; meta?: Record<string, unknown> } = {},
) {
  return new ApiError({
    code,
    message,
    status,
    url: "/exam-schedules",
    details: extra.field ? [{ field: extra.field, issue: message }] : [],
    meta: extra.meta,
  });
}

/** Mounts the tab and waits for the signed-in user, so an absent control is really absent. */
export async function renderTab(exam: ExamRecord = examRecord()) {
  renderWithProviders(
    <>
      <UserLoaded />
      <ScheduleTab exam={exam} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

/** Sets a date or time input: `user.type` can't drive jsdom's `date`/`time` inputs. */
export function setInput(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
