import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ExamRecord } from "@/services";
import {
  admitCardRecord,
  OTHER_CARD_ID,
  OTHER_SECTION_ID,
} from "@/services/modules/admit-cards/__tests__/admit-cards-fixtures";
import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import { renderWithProviders } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import { asUser } from "../../__tests__/exams-test-support";
import { AdmitCardsTab } from "../admit-cards-tab";

/** Shared setup for the Admit cards tab's tests; each file keeps its own `jest.mock` calls. */

export const CARD_VIEW = "exams.admit-card.view";
export const CARD_ISSUE = "exams.admit-card.issue";

/** Ali Raza's card: rendered and issued (the fixture's default). */
export const ISSUED = admitCardRecord();
/** Sara Khan's card in section B, revoked over fees. */
export const REVOKED = admitCardRecord({
  id: OTHER_CARD_ID,
  student_name: "Sara Khan",
  admission_number: "ADM-002",
  admit_card_no: "1A2B3C4D-ADM-002",
  section_id: OTHER_SECTION_ID,
  section_name: "B",
  status: "revoked",
  revoked_reason: "Fees outstanding",
});
/** Omar Malik's card, created but not rendered yet: no file. */
export const PENDING = admitCardRecord({
  id: "ace3f405-1627-4349-80ae-239001122334",
  student_name: "Omar Malik",
  admission_number: "ADM-003",
  admit_card_no: "1A2B3C4D-ADM-003",
  file_id: null,
  status: "generated",
  issued_at: null,
});

/** An exam whose schedule is published, so cards can be issued. */
export const PUBLISHED_EXAM = examRecord({ status: "scheduled" });

/** Signs in as exam staff who can view, issue and revoke cards. */
export function asIssuer() {
  asUser(CARD_VIEW, CARD_ISSUE);
}

/** Mounts the tab and waits for the signed-in user, so an absent control is really absent. */
export async function renderTab(exam: ExamRecord = PUBLISHED_EXAM) {
  renderWithProviders(
    <>
      <UserLoaded />
      <AdmitCardsTab exam={exam} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}
