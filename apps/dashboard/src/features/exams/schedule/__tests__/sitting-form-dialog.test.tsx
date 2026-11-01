import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import type { SectionOption } from "@/services";
import {
  conflictRecord,
  OTHER_SECTION_ID,
  SECTION_ID,
  SITTING_ID,
  sittingRecord,
  STAFF_ID,
} from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";
import {
  CLASS_ID,
  EXAM_SUBJECT_ID,
  OTHER_CLASS_ID,
  OTHER_SUBJECT_ID,
  subjectRecord,
} from "@/services/modules/exam-subjects/__tests__/exam-subjects-fixtures";
import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import { ROOM_ID, roomRecord } from "@/services/modules/rooms/__tests__/rooms-fixtures";
import { staffDirectoryRecord } from "@/services/modules/staff/__tests__/staff-fixtures";
import { CAMPUS_ID } from "@/test-fixtures/academics";
import { Services } from "@/services";

import {
  createSitting,
  fetchActiveRooms,
  fetchConflicts,
  fetchExamSubjects,
  fetchSections,
  fetchSittings,
  mocked,
  pick,
  stubExamsServices,
  updateSitting,
} from "../../__tests__/exams-test-support";
import { apiError, asScheduler, renderTab, setInput } from "./schedule-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ examsServicesMock: () => unknown }>("../../__tests__/exams-services-mock")
    .examsServicesMock(),
);

const SECTION_A: SectionOption = { id: SECTION_ID, name: "A", campus_id: CAMPUS_ID };
const SECTION_SIX: SectionOption = { id: OTHER_SECTION_ID, name: "C", campus_id: CAMPUS_ID };
const SCIENCE = subjectRecord({
  id: "68a9b0c1-d2e3-4ef5-8960-ef5667788990",
  class_id: OTHER_CLASS_ID,
  class_name: "Grade 6",
  subject_id: OTHER_SUBJECT_ID,
  subject_name: "Science",
});
const PAPER = "Mathematics (Grade 5)";

async function openAddDialog() {
  const user = await renderTab();
  await user.click(await screen.findByRole("button", { name: "Add sitting" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

async function fillRequired(user: Awaited<ReturnType<typeof renderTab>>) {
  await pick(user, "Paper", PAPER);
  await pick(user, "Section", "A");
  setInput("Date", "2026-10-05");
  setInput("Starts", "09:00");
  setInput("Ends", "11:00");
}

describe("SittingFormDialog", () => {
  beforeEach(() => {
    stubExamsServices();
    asScheduler();
    fetchExamSubjects.mockResolvedValue([subjectRecord(), SCIENCE]);
    fetchSections.mockImplementation(({ classId }) =>
      Promise.resolve(classId === CLASS_ID ? [SECTION_A] : [SECTION_SIX]),
    );
    fetchActiveRooms.mockResolvedValue([roomRecord()]);
    mocked(Services.staff.fetchTeachingStaffOptions).mockResolvedValue([
      staffDirectoryRecord({ id: STAFF_ID }),
    ]);
    fetchSittings.mockResolvedValue([sittingRecord()]);
  });

  describe("the pickers", () => {
    it("offers the exam's own subjects as the papers", async () => {
      const { user } = await openAddDialog();

      await user.click(screen.getByRole("combobox", { name: "Paper" }));

      expect(await screen.findByRole("option", { name: PAPER })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Science (Grade 6)" })).toBeInTheDocument();
      expect(fetchExamSubjects).toHaveBeenCalledWith(examRecord().id);
    });

    it("holds Section until a paper is picked, then offers the sections of that paper's class", async () => {
      const { user, dialog } = await openAddDialog();
      expect(within(dialog).getByRole("combobox", { name: "Section" })).toBeDisabled();

      await pick(user, "Paper", PAPER);

      await waitFor(() => {
        expect(fetchSections).toHaveBeenCalledWith({ classId: CLASS_ID, isActive: true });
      });
      expect(within(dialog).getByRole("combobox", { name: "Section" })).toBeEnabled();
      await user.click(screen.getByRole("combobox", { name: "Section" }));
      expect(await screen.findByRole("option", { name: "A" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "C" })).not.toBeInTheDocument();
    });

    it("follows a changed paper to its own class's sections, clearing the section picked before", async () => {
      const { user, dialog } = await openAddDialog();
      await pick(user, "Paper", PAPER);
      await pick(user, "Section", "A");
      expect(within(dialog).getByRole("combobox", { name: "Section" })).toHaveTextContent("A");

      await pick(user, "Paper", "Science (Grade 6)");

      await waitFor(() => {
        expect(fetchSections).toHaveBeenCalledWith({ classId: OTHER_CLASS_ID, isActive: true });
      });
      expect(within(dialog).getByRole("combobox", { name: "Section" })).toHaveTextContent(
        "Select a section",
      );
      await user.click(screen.getByRole("combobox", { name: "Section" }));
      expect(await screen.findByRole("option", { name: "C" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "A" })).not.toBeInTheDocument();
    });

    it("offers the rooms of the picked section's campus, since an exam has none of its own", async () => {
      const { user, dialog } = await openAddDialog();
      expect(within(dialog).getByRole("combobox", { name: "Room" })).toBeDisabled();
      expect(fetchActiveRooms).not.toHaveBeenCalled();

      await pick(user, "Paper", PAPER);
      await pick(user, "Section", "A");

      await waitFor(() => {
        expect(fetchActiveRooms).toHaveBeenCalledWith(CAMPUS_ID);
      });
      await user.click(screen.getByRole("combobox", { name: "Room" }));
      expect(await screen.findByRole("option", { name: "Room 101" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "No room" })).toBeInTheDocument();
    });

    it("offers the active teachers as invigilators, with a choice of none", async () => {
      const { user } = await openAddDialog();

      await user.click(screen.getByRole("combobox", { name: "Invigilator" }));

      expect(await screen.findByRole("option", { name: "Ayesha Khan" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "No invigilator" })).toBeInTheDocument();
    });
  });

  describe("saving", () => {
    it("sends a new sitting with no room and no invigilator as nulls", async () => {
      createSitting.mockResolvedValue({ sitting: sittingRecord(), conflicts: [] });
      const { user, dialog } = await openAddDialog();

      await fillRequired(user);
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(createSitting).toHaveBeenCalledWith({
          examSubjectId: EXAM_SUBJECT_ID,
          sectionId: SECTION_ID,
          examDate: "2026-10-05",
          startTime: "09:00",
          endTime: "11:00",
          roomId: null,
          invigilatorStaffId: null,
        });
      });
    });

    it("sends the room and the invigilator that were picked", async () => {
      createSitting.mockResolvedValue({ sitting: sittingRecord(), conflicts: [] });
      const { user, dialog } = await openAddDialog();

      await fillRequired(user);
      await pick(user, "Room", "Room 101");
      await pick(user, "Invigilator", "Ayesha Khan");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(createSitting).toHaveBeenCalledWith(
          expect.objectContaining({ roomId: ROOM_ID, invigilatorStaffId: STAFF_ID }),
        );
      });
    });

    it("asks for the paper, the section, the date and the times before sending", async () => {
      const { user, dialog } = await openAddDialog();

      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await within(dialog).findAllByText("This field is required.")).toHaveLength(5);
      expect(createSitting).not.toHaveBeenCalled();
    });

    it("refuses an end that is not after the start, under Ends", async () => {
      const { user, dialog } = await openAddDialog();

      await fillRequired(user);
      setInput("Ends", "09:00");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(
        await within(dialog).findByText("A sitting must end after it starts."),
      ).toBeInTheDocument();
      expect(createSitting).not.toHaveBeenCalled();
    });

    it("saves a sitting the server flags, closes, and reloads the clash list and the schedule", async () => {
      const clash = conflictRecord();
      createSitting.mockResolvedValue({ sitting: sittingRecord(), conflicts: [clash] });
      fetchConflicts.mockResolvedValueOnce([]).mockResolvedValue([clash]);
      const { user, dialog } = await openAddDialog();
      await screen.findByText("No clashes found.");
      const sittingReads = fetchSittings.mock.calls.length;

      await fillRequired(user);
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await screen.findByText(clash.message)).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(fetchSittings.mock.calls.length).toBeGreaterThan(sittingReads);
      expect(toast.success).toHaveBeenCalledWith("Sitting saved.");
    });
  });

  describe("server refusals", () => {
    it("puts a refusal naming Section under Section and keeps the dialog open", async () => {
      const refusal = "This section does not study this class.";
      createSitting.mockRejectedValue(
        apiError(422, "validation_error", refusal, { field: "section_id" }),
      );
      const { user, dialog } = await openAddDialog();
      await fillRequired(user);
      const reads = fetchSittings.mock.calls.length;

      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
      expect(within(dialog).getByRole("combobox", { name: "Section" })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // A field refusal is the form's to show: only a 409 means something moved on and reloads.
      expect(fetchSittings).toHaveBeenCalledTimes(reads);
    });

    it("puts the end-time refusal under Ends", async () => {
      const refusal = "A sitting must end after it starts.";
      createSitting.mockRejectedValue(
        apiError(422, "validation_error", refusal, { field: "end_time" }),
      );
      const { user, dialog } = await openAddDialog();
      await fillRequired(user);

      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Ends")).toHaveAttribute("aria-invalid", "true");
    });

    it("shows the server's own sentence for a 409 and reloads the schedule", async () => {
      const refusal = "This exam is marks entry and its configuration is frozen.";
      createSitting.mockRejectedValue(apiError(409, "conflict", refusal));
      const { user, dialog } = await openAddDialog();
      await fillRequired(user);
      const reads = fetchSittings.mock.calls.length;

      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
      await waitFor(() => {
        expect(fetchSittings.mock.calls.length).toBeGreaterThan(reads);
      });
    });
  });

  describe("rescheduling", () => {
    it("opens filled from the sitting, then sends the changed end time with the rest", async () => {
      updateSitting.mockResolvedValue({ sitting: sittingRecord(), conflicts: [] });
      const user = await renderTab();

      await user.click(
        await screen.findByRole("button", { name: "Reschedule Mathematics, Grade 5 A" }),
      );
      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText("Reschedule sitting")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-10-05");
      expect(within(dialog).getByLabelText("Starts")).toHaveValue("09:00");
      expect(within(dialog).getByLabelText("Ends")).toHaveValue("11:00");

      setInput("Ends", "12:00");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(updateSitting).toHaveBeenCalledWith(SITTING_ID, {
          examSubjectId: EXAM_SUBJECT_ID,
          sectionId: SECTION_ID,
          examDate: "2026-10-05",
          startTime: "09:00",
          endTime: "12:00",
          roomId: ROOM_ID,
          invigilatorStaffId: STAFF_ID,
        });
      });
      expect(createSitting).not.toHaveBeenCalled();
    });
  });
});
