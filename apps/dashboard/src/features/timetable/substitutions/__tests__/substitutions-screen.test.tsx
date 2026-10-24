import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { staffDirectoryRecord } from "@/services/modules/staff/__tests__/staff-fixtures";
import {
  PROPOSER_ID,
  SUBSTITUTION_ID,
  substitutionPage,
  substitutionRecord,
} from "@/services/modules/teacher-substitutions/__tests__/teacher-substitutions-fixtures";
import { slotRecord } from "@/services/modules/timetable-slots/__tests__/timetable-slots-fixtures";
import { SESSION_ID, SESSIONS } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { SubstitutionsTable } from "../substitutions-table";
import { SubstitutionsToolbar } from "../substitutions-toolbar";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    schoolOrganization: { fetchAcademicSessions: jest.fn() },
    staff: { fetchTeachingStaffOptions: jest.fn() },
    rooms: { fetchActiveRooms: jest.fn() },
    timetableSlots: { fetchTeacherClassesOn: jest.fn() },
    teacherSubstitutions: {
      fetchSubstitutionPage: jest.fn(),
      proposeSubstitution: jest.fn(),
      fetchCandidates: jest.fn(),
      decideSubstitution: jest.fn(),
    },
  },
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;
const svc = Services;

const ABSENT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const COVER_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

function asUser(id: string, ...keys: PermissionKey[]) {
  mocked(svc.auth.fetchCurrentUser).mockResolvedValue({
    ...buildUser(["timetable.timetable.view", ...keys]),
    id,
  });
}

function renderScreen() {
  renderWithProviders(
    <>
      <SubstitutionsToolbar />
      <SubstitutionsTable />
    </>,
  );
  return userEvent.setup();
}

describe("substitutions screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUrl("/timetable/substitutions");
    asUser("approver", "timetable.substitution.approve");
    mocked(svc.schoolOrganization.fetchAcademicSessions).mockResolvedValue(SESSIONS);
    mocked(svc.teacherSubstitutions.fetchSubstitutionPage).mockResolvedValue(
      substitutionPage([substitutionRecord()]),
    );
    mocked(svc.staff.fetchTeachingStaffOptions).mockResolvedValue([
      staffDirectoryRecord({ id: ABSENT_ID, first_name: "Amna", last_name: "Raza" }),
    ]);
    mocked(svc.rooms.fetchActiveRooms).mockResolvedValue([]);
  });

  it("lists cover by who is off, who covers and when", async () => {
    renderScreen();

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(screen.getByText("Bilal Khan")).toBeInTheDocument();
    expect(screen.getByText("Monday · Period 1")).toBeInTheDocument();
    expect(screen.getByText("Grade 5-A · Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
  });

  it("offers an approver approve, decline and cancel on a proposal", async () => {
    renderScreen();

    expect(
      await screen.findByRole("button", { name: /^Approve cover for Amna Raza/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Decline cover for Amna Raza/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Cancel cover for Amna Raza/ })).toBeInTheDocument();
  });

  it("offers a proposer only the withdrawal of their own proposal", async () => {
    asUser(PROPOSER_ID, "timetable.substitution.create");
    mocked(svc.teacherSubstitutions.fetchSubstitutionPage).mockResolvedValue(
      substitutionPage([
        substitutionRecord(),
        substitutionRecord({
          id: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f",
          absent_staff_name: "Sara Ali",
          created_by: "someone-else",
        }),
      ]),
    );
    renderScreen();

    expect(
      await screen.findByRole("button", { name: /^Cancel cover for Amna Raza/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Cancel cover for Sara Ali/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve cover/ })).not.toBeInTheDocument();
  });

  it("cancels through the confirm, and refreshes the queue", async () => {
    mocked(svc.teacherSubstitutions.decideSubstitution).mockResolvedValue(
      substitutionRecord({ status: "cancelled" }),
    );
    const invalidate = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: /^Cancel cover for Amna Raza/ }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel cover" }),
    );

    await waitFor(() => {
      expect(svc.teacherSubstitutions.decideSubstitution).toHaveBeenCalledWith(
        SUBSTITUTION_ID,
        "cancel",
      );
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["teacher-substitutions"] });
    invalidate.mockRestore();
  });

  it("refreshes the queue when someone decided first, keeping the dialog open", async () => {
    mocked(svc.teacherSubstitutions.decideSubstitution).mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "This substitution is confirmed and cannot be decided again.",
        status: 409,
        url: `/teacher-substitutions/${SUBSTITUTION_ID}:approve`,
      }),
    );
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: /^Approve cover for Amna Raza/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(svc.teacherSubstitutions.fetchSubstitutionPage).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("proposes cover through the chain: date, teacher, class, a free colleague", async () => {
    asUser(PROPOSER_ID, "timetable.substitution.create");
    const slot = slotRecord({ staff_id: ABSENT_ID });
    mocked(svc.timetableSlots.fetchTeacherClassesOn).mockResolvedValue([slot]);
    mocked(svc.teacherSubstitutions.fetchCandidates).mockResolvedValue([
      { staff_id: COVER_ID, staff_name: "Bilal Khan", employee_number: "E-2" },
    ]);
    mocked(svc.teacherSubstitutions.proposeSubstitution).mockResolvedValue(substitutionRecord());
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Propose a substitution" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-10-19" } });
    await user.click(within(dialog).getByRole("combobox", { name: "Absent teacher" }));
    await user.click(await screen.findByRole("option", { name: "Amna Raza" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Class to cover" }));
    await user.click(await screen.findByRole("option", { name: "Period 1 · A · Mathematics" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Covering teacher" }));
    await user.click(await screen.findByRole("option", { name: "Bilal Khan" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(svc.teacherSubstitutions.proposeSubstitution).toHaveBeenCalledWith({
        timetableSlotId: slot.id,
        date: "2026-10-19",
        absentStaffId: ABSENT_ID,
        substituteStaffId: COVER_ID,
        roomId: null,
        reason: null,
      });
    });
    // A Monday: the teacher's classes were asked for on weekday 0, in the current session.
    expect(svc.timetableSlots.fetchTeacherClassesOn).toHaveBeenCalledWith(SESSION_ID, ABSENT_ID, 0);
    expect(svc.teacherSubstitutions.fetchCandidates).toHaveBeenCalledWith(slot.id, "2026-10-19");
  });

  describe("the propose chain", () => {
    const OTHER_TEACHER_ID = "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f";
    const SECOND_SLOT_ID = "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a";

    beforeEach(() => {
      asUser(PROPOSER_ID, "timetable.substitution.create");
      mocked(svc.staff.fetchTeachingStaffOptions).mockResolvedValue([
        staffDirectoryRecord({ id: ABSENT_ID, first_name: "Amna", last_name: "Raza" }),
        staffDirectoryRecord({ id: OTHER_TEACHER_ID, first_name: "Sara", last_name: "Malik" }),
      ]);
      // The same classes and the same free colleague whatever is asked, so a step that kept
      // its stale value would still find it among the new options: only the reset clears it.
      mocked(svc.timetableSlots.fetchTeacherClassesOn).mockResolvedValue([
        slotRecord({ staff_id: ABSENT_ID }),
        slotRecord({ id: SECOND_SLOT_ID, staff_id: ABSENT_ID, period_name: "Period 2" }),
      ]);
      mocked(svc.teacherSubstitutions.fetchCandidates).mockResolvedValue([
        { staff_id: COVER_ID, staff_name: "Bilal Khan", employee_number: "E-2" },
      ]);
    });

    async function pickThroughCover() {
      const user = renderScreen();
      await user.click(await screen.findByRole("button", { name: "Propose a substitution" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Date"), {
        target: { value: "2026-10-19" },
      });
      await user.click(within(dialog).getByRole("combobox", { name: "Absent teacher" }));
      await user.click(await screen.findByRole("option", { name: "Amna Raza" }));
      await user.click(within(dialog).getByRole("combobox", { name: "Class to cover" }));
      await user.click(await screen.findByRole("option", { name: "Period 1 · A · Mathematics" }));
      await user.click(within(dialog).getByRole("combobox", { name: "Covering teacher" }));
      await user.click(await screen.findByRole("option", { name: "Bilal Khan" }));
      return { user, dialog };
    }

    it("clears the class and the cover once the date changes", async () => {
      const { dialog } = await pickThroughCover();

      fireEvent.change(within(dialog).getByLabelText("Date"), {
        target: { value: "2026-10-20" },
      });

      await waitFor(() => {
        expect(svc.timetableSlots.fetchTeacherClassesOn).toHaveBeenCalledWith(
          SESSION_ID,
          ABSENT_ID,
          1,
        );
      });
      const classSelect = within(dialog).getByRole("combobox", { name: "Class to cover" });
      await waitFor(() => {
        expect(classSelect).toHaveTextContent("Select one of their classes");
      });
      expect(
        within(dialog).getByRole("combobox", { name: "Covering teacher" }),
      ).not.toHaveTextContent("Bilal Khan");
    });

    it("clears the class and the cover once the absent teacher changes", async () => {
      const { user, dialog } = await pickThroughCover();

      await user.click(within(dialog).getByRole("combobox", { name: "Absent teacher" }));
      await user.click(await screen.findByRole("option", { name: "Sara Malik" }));

      const classSelect = within(dialog).getByRole("combobox", { name: "Class to cover" });
      await waitFor(() => {
        expect(classSelect).toHaveTextContent("Select one of their classes");
      });
      expect(
        within(dialog).getByRole("combobox", { name: "Covering teacher" }),
      ).not.toHaveTextContent("Bilal Khan");
    });

    it("clears the cover once the class changes", async () => {
      const { user, dialog } = await pickThroughCover();

      await user.click(within(dialog).getByRole("combobox", { name: "Class to cover" }));
      await user.click(await screen.findByRole("option", { name: "Period 2 · A · Mathematics" }));

      await waitFor(() => {
        expect(svc.teacherSubstitutions.fetchCandidates).toHaveBeenCalledWith(
          SECOND_SLOT_ID,
          "2026-10-19",
        );
      });
      await waitFor(() => {
        expect(
          within(dialog).getByRole("combobox", { name: "Covering teacher" }),
        ).not.toHaveTextContent("Bilal Khan");
      });
    });
  });
});
