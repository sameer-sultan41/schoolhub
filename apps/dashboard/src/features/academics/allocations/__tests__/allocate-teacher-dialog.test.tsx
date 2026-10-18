import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import { curriculumRecord } from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import {
  OTHER_CLASS_ID,
  OTHER_STAFF_ID,
  OTHER_SUBJECT_ID,
  overNormWarning,
  savedAllocation,
  SECTION_ID,
  STAFF_ID,
  teacherRecord,
} from "@/services/modules/teacher-allocations/__tests__/teacher-allocations-fixtures";
import { CLASS_ID, SESSION_ID, SUBJECT_ID } from "@/test-fixtures/academics";
import { renderWithProviders } from "@/test-utils";

import { AllocateTeacherDialog } from "../allocate-teacher-dialog";

// Saving surfaces as toasts, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    teacherAllocations: { allocateTeacher: jest.fn() },
    curriculum: { fetchCurriculumForClass: jest.fn() },
    staff: { fetchTeachingStaffOptions: jest.fn() },
    schoolOrganization: { fetchClasses: jest.fn(), fetchSections: jest.fn() },
  },
}));

const mockAllocateTeacher = Services.teacherAllocations.allocateTeacher as jest.MockedFunction<
  typeof Services.teacherAllocations.allocateTeacher
>;
const mockFetchCurriculumForClass = Services.curriculum
  .fetchCurriculumForClass as jest.MockedFunction<
  typeof Services.curriculum.fetchCurriculumForClass
>;
const mockFetchTeachingStaff = Services.staff.fetchTeachingStaffOptions as jest.MockedFunction<
  typeof Services.staff.fetchTeachingStaffOptions
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;
const mockToastWarning = toast.warning as jest.MockedFunction<typeof toast.warning>;

type User = ReturnType<typeof userEvent.setup>;

function renderDialog() {
  const onOpenChange = jest.fn();
  renderWithProviders(
    <AllocateTeacherDialog open onOpenChange={onOpenChange} sessionId={SESSION_ID} />,
  );
  return { onOpenChange, user: userEvent.setup() };
}

async function pick(user: User, field: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

/** The four selects an allocation can't be saved without, in the order they cascade. */
async function pickEverything(user: User) {
  await pick(user, "Class", "Grade 1");
  await pick(user, "Section", "A");
  await pick(user, "Subject", "Mathematics");
  await pick(user, "Teacher", "Ayesha Khan");
}

function save(user: User) {
  return user.click(screen.getByRole("button", { name: "Save" }));
}

function apiError(status: number, code: string, field: string, issue: string) {
  return new ApiError({
    code,
    message: issue,
    status,
    url: "/teacher-subject-allocations",
    details: [{ field, issue }],
  });
}

describe("AllocateTeacherDialog", () => {
  beforeEach(() => {
    mockAllocateTeacher.mockReset().mockResolvedValue(savedAllocation());
    mockToastSuccess.mockReset();
    mockToastWarning.mockReset();
    mockFetchClasses.mockReset().mockResolvedValue([
      { id: CLASS_ID, name: "Grade 1" },
      { id: OTHER_CLASS_ID, name: "Grade 2" },
    ]);
    mockFetchSections.mockReset().mockResolvedValue([{ id: SECTION_ID, name: "A" }]);
    mockFetchCurriculumForClass
      .mockReset()
      .mockResolvedValue([
        curriculumRecord(),
        curriculumRecord({ id: "c2", subject_id: OTHER_SUBJECT_ID, subject_name: "English" }),
      ]);
    mockFetchTeachingStaff
      .mockReset()
      .mockResolvedValue([
        teacherRecord(),
        teacherRecord({ id: OTHER_STAFF_ID, first_name: "Bilal", last_name: "Ahmed" }),
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the fields", () => {
    it("offers active classes, and no section or subject until a class is picked", async () => {
      renderDialog();

      await waitFor(() => {
        expect(mockFetchClasses).toHaveBeenCalledWith({ isActive: true });
      });
      expect(screen.getByRole("combobox", { name: "Section" })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "Subject" })).toBeDisabled();
      expect(mockFetchSections).not.toHaveBeenCalled();
      expect(mockFetchCurriculumForClass).not.toHaveBeenCalled();
    });

    it("starts as the primary teacher, with the hint about co-teachers", () => {
      renderDialog();

      expect(screen.getByRole("switch", { name: "Primary teacher" })).toBeChecked();
      expect(
        screen.getByText(
          "One primary teacher per section and subject at a time; others are co-teachers.",
        ),
      ).toBeInTheDocument();
    });

    it("offers the active teaching staff, with the hint about who can be allocated", async () => {
      const { user } = renderDialog();

      await user.click(screen.getByRole("combobox", { name: "Teacher" }));

      expect(await screen.findByRole("option", { name: "Ayesha Khan" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Bilal Ahmed" })).toBeInTheDocument();
      expect(screen.getByText("Only active teaching staff can be allocated.")).toBeInTheDocument();
    });

    it("shows the hint about the curriculum, and the blank-periods hint", () => {
      renderDialog();

      expect(
        screen.getByText(
          "The subject must already be part of the section's class curriculum for this session.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Leave blank to use the curriculum's own weekly period target."),
      ).toBeInTheDocument();
    });

    it("offers the chosen class's active sections", async () => {
      const { user } = renderDialog();

      await pick(user, "Class", "Grade 1");

      await waitFor(() => {
        expect(mockFetchSections).toHaveBeenCalledWith({ classId: CLASS_ID, isActive: true });
      });
      await user.click(screen.getByRole("combobox", { name: "Section" }));
      expect(await screen.findByRole("option", { name: "A" })).toBeInTheDocument();
    });

    it("offers the subjects in the chosen class's curriculum for the session", async () => {
      const { user } = renderDialog();

      await pick(user, "Class", "Grade 1");
      await user.click(screen.getByRole("combobox", { name: "Subject" }));

      expect(await screen.findByRole("option", { name: "Mathematics" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
      expect(mockFetchCurriculumForClass).toHaveBeenCalledWith(SESSION_ID, CLASS_ID);
    });

    it("asks for the new class's curriculum when the class changes", async () => {
      const { user } = renderDialog();

      await pick(user, "Class", "Grade 1");
      await waitFor(() => {
        expect(mockFetchCurriculumForClass).toHaveBeenCalledWith(SESSION_ID, CLASS_ID);
      });
      await pick(user, "Class", "Grade 2");

      await waitFor(() => {
        expect(mockFetchCurriculumForClass).toHaveBeenCalledWith(SESSION_ID, OTHER_CLASS_ID);
      });
    });

    it("offers a subject once even when its curriculum maps it for several campuses", async () => {
      mockFetchCurriculumForClass.mockResolvedValue([
        curriculumRecord(),
        curriculumRecord({ id: "c2", campus_id: null, campus_name: null }),
      ]);
      const { user } = renderDialog();

      await pick(user, "Class", "Grade 1");
      await user.click(screen.getByRole("combobox", { name: "Subject" }));

      expect(await screen.findAllByRole("option", { name: "Mathematics" })).toHaveLength(1);
    });

    it("says so when the class has no curriculum for the session", async () => {
      mockFetchCurriculumForClass.mockResolvedValue([]);
      const { user } = renderDialog();

      expect(screen.queryByText(/has no curriculum for the session yet/)).not.toBeInTheDocument();

      await pick(user, "Class", "Grade 1");

      expect(
        await screen.findByText(
          "This class has no curriculum for the session yet. Add its subjects under Curriculum first.",
        ),
      ).toBeInTheDocument();
    });

    it("clears the section and the subject when another class is picked", async () => {
      const { user } = renderDialog();

      await pick(user, "Class", "Grade 1");
      await pick(user, "Section", "A");
      await pick(user, "Subject", "Mathematics");
      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "Subject" })).toHaveTextContent("Mathematics");
      });

      await pick(user, "Class", "Grade 2");

      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "Section" })).toHaveTextContent(
          "Select a section",
        );
        expect(screen.getByRole("combobox", { name: "Subject" })).toHaveTextContent(
          "Select a subject",
        );
      });
    });
  });

  describe("saving", () => {
    it("sends the picked section, subject and teacher, primary, with no override or dates", async () => {
      const { onOpenChange, user } = renderDialog();

      await pickEverything(user);
      await save(user);

      await waitFor(() => {
        expect(mockAllocateTeacher).toHaveBeenCalledWith({
          academicSessionId: SESSION_ID,
          sectionId: SECTION_ID,
          subjectId: SUBJECT_ID,
          staffId: STAFF_ID,
          isPrimary: true,
          weeklyPeriods: null,
          effectiveFrom: null,
        });
      });
      // The create body has no end date at all: an allocation is never made already ended.
      expect(mockAllocateTeacher.mock.calls[0]?.[0]).not.toHaveProperty("effectiveTo");
      expect(mockAllocateTeacher.mock.calls[0]?.[0]).not.toHaveProperty("classId");
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockToastSuccess).toHaveBeenCalledWith("Allocation saved.");
      expect(mockToastWarning).not.toHaveBeenCalled();
    });

    it("sends the co-teacher flag, the override as a number and the start date", async () => {
      const { user } = renderDialog();

      await pickEverything(user);
      await user.click(screen.getByRole("switch", { name: "Primary teacher" }));
      await user.type(screen.getByLabelText("Weekly periods"), "6");
      fireEvent.change(screen.getByLabelText("Effective from"), {
        target: { value: "2026-09-01" },
      });
      await save(user);

      await waitFor(() => {
        expect(mockAllocateTeacher).toHaveBeenCalledWith({
          academicSessionId: SESSION_ID,
          sectionId: SECTION_ID,
          subjectId: SUBJECT_ID,
          staffId: STAFF_ID,
          isPrimary: false,
          weeklyPeriods: 6,
          effectiveFrom: "2026-09-01",
        });
      });
    });

    it("asks for the class, section, subject and teacher, and sends nothing without them", async () => {
      const { user } = renderDialog();

      await save(user);

      expect(await screen.findAllByText("This field is required.")).toHaveLength(4);
      expect(mockAllocateTeacher).not.toHaveBeenCalled();
    });

    it("asks for a whole number of periods when the override is 0", async () => {
      const { user } = renderDialog();

      await pickEverything(user);
      await user.type(screen.getByLabelText("Weekly periods"), "0");
      await save(user);

      expect(await screen.findByText("Enter a whole number of at least 1.")).toBeInTheDocument();
      expect(mockAllocateTeacher).not.toHaveBeenCalled();
    });

    it("refreshes everything under teacher-allocations once it is saved", async () => {
      const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
      const { onOpenChange, user } = renderDialog();

      await pickEverything(user);
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["teacher-allocations"] });
    });

    it("warns when the teacher is over the norm, and the save still stands", async () => {
      mockAllocateTeacher.mockResolvedValue(savedAllocation([overNormWarning()]));
      const { onOpenChange, user } = renderDialog();

      await pickEverything(user);
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockToastSuccess).toHaveBeenCalledWith("Allocation saved.");
      expect(mockToastWarning).toHaveBeenCalledWith(
        "This teacher is now allocated 34 periods a week, above the norm of 30. The allocation was saved.",
      );
    });
  });

  describe("when the server refuses", () => {
    it("shows a 422 on staff_id under the teacher field and stays open", async () => {
      const issue = "This teacher is on leave for the whole session.";
      mockAllocateTeacher.mockRejectedValue(
        apiError(422, "domain_rule_violation", "staff_id", issue),
      );
      const { onOpenChange, user } = renderDialog();

      await pickEverything(user);
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Teacher" })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByRole("combobox", { name: "Subject" })).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it.each([
      ["subject_id", "Subject", "Mathematics is not in this class's curriculum."],
      ["section_id", "Section", "This section is not active."],
    ])("shows a 422 on %s under the %s field", async (field, label, issue) => {
      mockAllocateTeacher.mockRejectedValue(apiError(422, "domain_rule_violation", field, issue));
      const { user } = renderDialog();

      await pickEverything(user);
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: label })).toHaveAttribute("aria-invalid", "true");
    });

    it("shows an error on a field the form has no input for as the form's own message", async () => {
      const issue = "Academic session '2026-27' is closed and cannot be modified.";
      mockAllocateTeacher.mockRejectedValue(
        apiError(422, "domain_rule_violation", "academic_session_id", issue),
      );
      const { onOpenChange, user } = renderDialog();

      await pickEverything(user);
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Teacher" })).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("shows a refusal that names no field as the form's own message", async () => {
      const issue = "This teacher already teaches this subject to this section.";
      mockAllocateTeacher.mockRejectedValue(apiError(409, "conflict", "non_field", issue));
      const { user } = renderDialog();

      await pickEverything(user);
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
    });

    it("drops the form's message when the next attempt is made", async () => {
      const issue = "This teacher already teaches this subject to this section.";
      mockAllocateTeacher
        .mockRejectedValueOnce(apiError(409, "conflict", "non_field", issue))
        .mockResolvedValue(savedAllocation());
      const { onOpenChange, user } = renderDialog();

      await pickEverything(user);
      await save(user);
      expect(await screen.findByText(issue)).toBeInTheDocument();
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockAllocateTeacher).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(issue)).not.toBeInTheDocument();
    });

    it("falls back to a generic message for a failure that isn't an API error", async () => {
      mockAllocateTeacher.mockRejectedValue(new TypeError("Failed to fetch"));
      const { user } = renderDialog();

      await pickEverything(user);
      await save(user);

      const message = await screen.findByText("Something went wrong. Please try again.");
      expect(message).toBeInTheDocument();
    });
  });

  it("closes without saving on Cancel", async () => {
    const { onOpenChange, user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockAllocateTeacher).not.toHaveBeenCalled();
  });
});
