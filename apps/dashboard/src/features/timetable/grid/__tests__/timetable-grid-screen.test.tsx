import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services, type TimetableSlotRecord } from "@/services";
import { curriculumRecord } from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import { periodRecord } from "@/services/modules/periods/__tests__/periods-fixtures";
import { staffDirectoryRecord } from "@/services/modules/staff/__tests__/staff-fixtures";
import {
  conflict,
  PERIOD_1_ID,
  PERIOD_2_ID,
  SECTION_ID,
  SUBJECT_ID,
  TEACHER_ID,
  slotRecord,
} from "@/services/modules/timetable-slots/__tests__/timetable-slots-fixtures";
import {
  CAMPUS_ID,
  CLASS_ID,
  CLOSED_SESSION,
  CLOSED_SESSION_ID,
  SESSION_ID,
  SESSIONS,
} from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { TimetableGridScreen } from "../timetable-grid-screen";

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
    schoolOrganization: {
      fetchAcademicSessions: jest.fn(),
      fetchClasses: jest.fn(),
      fetchSections: jest.fn(),
    },
    periods: { fetchCampusPeriods: jest.fn() },
    rooms: { fetchActiveRooms: jest.fn() },
    curriculum: { fetchCurriculumForClass: jest.fn() },
    staff: { fetchTeachingStaffOptions: jest.fn() },
    teacherAllocations: { fetchSectionAllocations: jest.fn() },
    timetableSlots: {
      fetchSectionSlots: jest.fn(),
      createSlot: jest.fn(),
      updateSlot: jest.fn(),
      deleteSlot: jest.fn(),
      validateSection: jest.fn(),
      publishSection: jest.fn(),
    },
  },
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;
const svc = Services;

const BUILDER: PermissionKey[] = [
  "timetable.slot.view",
  "timetable.slot.create",
  "timetable.slot.update",
  "timetable.slot.delete",
  "timetable.timetable.publish",
];

/** Monday, Period 1: a draft; Tuesday, Period 1: published; Period 2 is a break. */
function seedGrid(
  slots: TimetableSlotRecord[] = [
    slotRecord(),
    slotRecord({ day_of_week: 1, status: "published" }),
  ],
) {
  mocked(svc.timetableSlots.fetchSectionSlots).mockResolvedValue(slots);
}

function renderScreen(url = `/timetable/grid?class=${CLASS_ID}&section=${SECTION_ID}`) {
  setUrl(url);
  renderWithProviders(<TimetableGridScreen />);
  return userEvent.setup();
}

describe("TimetableGridScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked(svc.auth.fetchCurrentUser).mockResolvedValue(buildUser(BUILDER));
    mocked(svc.schoolOrganization.fetchAcademicSessions).mockResolvedValue(SESSIONS);
    mocked(svc.schoolOrganization.fetchClasses).mockResolvedValue([
      { id: CLASS_ID, name: "Grade 1" },
    ]);
    mocked(svc.schoolOrganization.fetchSections).mockResolvedValue([
      { id: SECTION_ID, name: "A", campus_id: CAMPUS_ID },
    ]);
    mocked(svc.periods.fetchCampusPeriods).mockResolvedValue([
      periodRecord({ id: PERIOD_1_ID, name: "Period 1", sequence: 1 }),
      periodRecord({ id: PERIOD_2_ID, name: "Recess", sequence: 2, is_break: true }),
    ]);
    mocked(svc.rooms.fetchActiveRooms).mockResolvedValue([]);
    // The cell's own picks are among the options, as they are for a real cell.
    mocked(svc.curriculum.fetchCurriculumForClass).mockResolvedValue([
      curriculumRecord({ subject_id: SUBJECT_ID, subject_name: "Mathematics" }),
    ]);
    mocked(svc.staff.fetchTeachingStaffOptions).mockResolvedValue([
      staffDirectoryRecord({ id: TEACHER_ID, first_name: "Amna", last_name: "Raza" }),
    ]);
    mocked(svc.teacherAllocations.fetchSectionAllocations).mockResolvedValue([]);
    seedGrid();
  });

  it("asks for a section before drawing anything", async () => {
    renderScreen("/timetable/grid");

    expect(await screen.findByText("Pick a section")).toBeInTheDocument();
    expect(svc.timetableSlots.fetchSectionSlots).not.toHaveBeenCalled();
  });

  it("draws the section's week from the current session, with breaks inert", async () => {
    renderScreen();

    expect(
      await screen.findByRole("button", { name: "Edit Monday · Period 1" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fill Wednesday · Period 1" })).toBeInTheDocument();
    expect(screen.getAllByText("Break")).toHaveLength(5);
    expect(svc.timetableSlots.fetchSectionSlots).toHaveBeenCalledWith(SESSION_ID, SECTION_ID);
    expect(svc.periods.fetchCampusPeriods).toHaveBeenCalledWith(CAMPUS_ID);
  });

  it("gives a pure draft a move handle, and a published cell none", async () => {
    renderScreen();

    expect(
      await screen.findByRole("button", { name: "Move Monday · Period 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Move Tuesday · Period 1" }),
    ).not.toBeInTheDocument();
  });

  it("drafts over a published cell rather than editing it in place", async () => {
    mocked(svc.timetableSlots.createSlot).mockResolvedValue({ slot: slotRecord(), conflicts: [] });
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Edit Tuesday · Period 1" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(svc.timetableSlots.createSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          dayOfWeek: 1,
          periodId: PERIOD_1_ID,
          subjectId: SUBJECT_ID,
          staffId: TEACHER_ID,
        }),
      );
    });
    expect(svc.timetableSlots.updateSlot).not.toHaveBeenCalled();
  });

  it("updates a draft, and shows the conflicts the save answers with", async () => {
    const draft = slotRecord();
    seedGrid([draft]);
    mocked(svc.timetableSlots.updateSlot).mockResolvedValue({
      slot: draft,
      conflicts: [conflict({ type: "teacher_not_allocated", slot_ids: [draft.id] })],
    });
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Edit Monday · Period 1" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }),
    );

    const list = await screen.findByRole("list", { name: "Conflicts" });
    expect(
      within(list).getByText(/no allocation for this section and subject/),
    ).toBeInTheDocument();
    expect(svc.timetableSlots.updateSlot).toHaveBeenCalledWith(draft.id, expect.any(Object));
  });

  it("says no conflicts after a clean check, outside the list", async () => {
    mocked(svc.timetableSlots.validateSection).mockResolvedValue({
      section_id: SECTION_ID,
      academic_session_id: SESSION_ID,
      conflicts: [],
      has_hard_conflicts: false,
    });
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Check for conflicts" }));

    expect(await screen.findByText("No conflicts found.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Conflicts" })).not.toBeInTheDocument();
  });

  it("keeps a refused publish open and lists its findings, falling back to the server's text", async () => {
    const draft = slotRecord();
    seedGrid([draft]);
    mocked(svc.timetableSlots.publishSection).mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "This timetable has unresolved hard conflicts and cannot be published.",
        status: 422,
        url: `/timetables/${SECTION_ID}:publish`,
        details: [
          {
            field: "non_field",
            issue: "This timetable has unresolved hard conflicts and cannot be published.",
          },
        ],
        meta: {
          conflicts: [
            conflict({ type: "brand_new_rule", message: "Server says why.", slot_ids: [draft.id] }),
          ],
        },
      }),
    );
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));

    expect(await within(dialog).findByText(/unresolved hard conflicts/)).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Conflicts" });
    expect(within(list).getByText("Server says why.")).toBeInTheDocument();
  });

  it("lets a publisher without the cell keys publish, with every cell inert", async () => {
    mocked(svc.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["timetable.slot.view", "timetable.timetable.publish"]),
    );
    renderScreen();

    expect(await screen.findByRole("button", { name: "Publish" })).toBeInTheDocument();
    // Both cells drawn, so the absence below is about permissions, not loading.
    expect(await screen.findAllByText("Mathematics")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^(Fill|Edit|Move) / })).not.toBeInTheDocument();
  });

  it("shows a closed session read-only: no Publish, no cell editor", async () => {
    renderScreen(
      `/timetable/grid?session=${CLOSED_SESSION_ID}&class=${CLASS_ID}&section=${SECTION_ID}`,
    );

    expect(
      await screen.findByText(`${CLOSED_SESSION.name} is closed, so its records are read-only.`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(await screen.findAllByText("Mathematics")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /^(Fill|Edit|Move|Discard the draft for) / }),
    ).not.toBeInTheDocument();
  });

  it("fills an empty cell with the picked subject, and None for the rest", async () => {
    mocked(svc.timetableSlots.createSlot).mockResolvedValue({ slot: slotRecord(), conflicts: [] });
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Fill Wednesday · Period 1" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Subject" }));
    await user.click(await screen.findByRole("option", { name: "Mathematics" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(svc.timetableSlots.createSlot).toHaveBeenCalledWith({
        academicSessionId: SESSION_ID,
        sectionId: SECTION_ID,
        dayOfWeek: 2,
        periodId: PERIOD_1_ID,
        subjectId: SUBJECT_ID,
        staffId: null,
        roomId: null,
        notes: null,
      });
    });
  });

  it("shows a server error on the teacher under the Teacher picker", async () => {
    mocked(svc.timetableSlots.updateSlot).mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Only an active teaching staff member can hold a period.",
        status: 422,
        url: "/timetable-slots",
        details: [
          { field: "staff_id", issue: "Only an active teaching staff member can hold a period." },
        ],
      }),
    );
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Edit Monday · Period 1" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("Only an active teaching staff member can hold a period."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Teacher" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("discards a draft and refreshes the grid", async () => {
    const draft = slotRecord();
    seedGrid([draft]);
    mocked(svc.timetableSlots.deleteSlot).mockResolvedValue({ slot: null, conflicts: [] });
    const invalidate = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const user = renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Discard the draft for Monday · Period 1" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Discard draft" }));

    await waitFor(() => {
      expect(svc.timetableSlots.deleteSlot).toHaveBeenCalledWith(draft.id);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["timetable-slots"] });
    invalidate.mockRestore();
  });

  it("publishes, then refreshes the grid and the home screen's next period", async () => {
    mocked(svc.timetableSlots.publishSection).mockResolvedValue({
      published: 1,
      superseded: 0,
      conflicts: [],
    });
    const invalidate = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Publish" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publish" }),
    );

    await waitFor(() => {
      expect(svc.timetableSlots.publishSection).toHaveBeenCalledWith(SECTION_ID, SESSION_ID);
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["timetable-slots"] });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard", "my-timetable"] });
    invalidate.mockRestore();
  });

  it("forgets a section's findings once another section is picked", async () => {
    const otherSectionId = "b8c9d0e1-f2a3-4b4c-9d6e-7f8a9b0c1d2e";
    mocked(svc.schoolOrganization.fetchSections).mockResolvedValue([
      { id: SECTION_ID, name: "A", campus_id: CAMPUS_ID },
      { id: otherSectionId, name: "B", campus_id: CAMPUS_ID },
    ]);
    mocked(svc.timetableSlots.validateSection).mockResolvedValue({
      section_id: SECTION_ID,
      academic_session_id: SESSION_ID,
      conflicts: [conflict({ slot_ids: ["x"] })],
      has_hard_conflicts: true,
    });
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Check for conflicts" }));
    expect(await screen.findByRole("list", { name: "Conflicts" })).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Section" }));
    await user.click(await screen.findByRole("option", { name: "B" }));

    await waitFor(() => {
      expect(screen.queryByRole("list", { name: "Conflicts" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("No conflicts found.")).not.toBeInTheDocument();
  });
});
