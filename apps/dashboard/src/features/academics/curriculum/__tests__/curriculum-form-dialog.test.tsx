import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import {
  curriculumRecord,
  RECORD_ID,
} from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import { CAMPUS_ID, CLASS_ID, SESSION_ID, SESSIONS, SUBJECT_ID } from "@/test-fixtures/academics";
import { renderWithProviders } from "@/test-utils";

import { CurriculumFormDialog } from "../curriculum-form-dialog";

// Saving surfaces as a toast, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    curriculum: { createCurriculum: jest.fn(), updateCurriculum: jest.fn() },
    dashboard: { fetchCampuses: jest.fn() },
    schoolOrganization: { fetchClasses: jest.fn(), fetchSubjects: jest.fn() },
  },
}));

const mockCreateCurriculum = Services.curriculum.createCurriculum as jest.MockedFunction<
  typeof Services.curriculum.createCurriculum
>;
const mockUpdateCurriculum = Services.curriculum.updateCurriculum as jest.MockedFunction<
  typeof Services.curriculum.updateCurriculum
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSubjects = Services.schoolOrganization.fetchSubjects as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSubjects
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

type User = ReturnType<typeof userEvent.setup>;

function renderCreate() {
  const onOpenChange = jest.fn();
  renderWithProviders(
    <CurriculumFormDialog
      open
      onOpenChange={onOpenChange}
      sessions={SESSIONS}
      sessionId={SESSION_ID}
    />,
  );
  return { onOpenChange, user: userEvent.setup() };
}

function renderEdit(record = curriculumRecord()) {
  const onOpenChange = jest.fn();
  renderWithProviders(
    <CurriculumFormDialog
      open
      onOpenChange={onOpenChange}
      sessions={SESSIONS}
      sessionId={SESSION_ID}
      record={record}
    />,
  );
  return { onOpenChange, user: userEvent.setup() };
}

async function pick(user: User, field: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

/** The two selects a new mapping can't be saved without. */
async function pickClassAndSubject(user: User) {
  await pick(user, "Class", "Grade 1");
  await pick(user, "Subject", "Mathematics");
}

function save(user: User) {
  return user.click(screen.getByRole("button", { name: "Save" }));
}

function apiError(status: number, code: string, field: string, issue: string) {
  return new ApiError({
    code,
    message: issue,
    status,
    url: "/class-subjects",
    details: [{ field, issue }],
  });
}

describe("CurriculumFormDialog", () => {
  beforeEach(() => {
    mockCreateCurriculum.mockReset();
    mockUpdateCurriculum.mockReset();
    mockToastSuccess.mockReset();
    mockFetchClasses.mockReset().mockResolvedValue([{ id: CLASS_ID, name: "Grade 1" }]);
    mockFetchSubjects.mockReset().mockResolvedValue([{ id: SUBJECT_ID, name: "Mathematics" }]);
    mockFetchCampuses.mockReset().mockResolvedValue([{ id: CAMPUS_ID, name: "Main Campus" }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("adding a subject", () => {
    it("offers active classes and subjects only", async () => {
      renderCreate();

      await waitFor(() => {
        expect(mockFetchClasses).toHaveBeenCalledWith({ isActive: true });
      });
      expect(mockFetchSubjects).toHaveBeenCalledWith({ isActive: true });
    });

    it("offers the sessions that aren't locked, starting on the screen's", async () => {
      const { user } = renderCreate();

      const session = screen.getByRole("combobox", { name: "Academic session" });
      await waitFor(() => {
        expect(session).toHaveTextContent("2026-27");
      });
      await user.click(session);

      expect(await screen.findByRole("option", { name: "2027-28" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "2025-26" })).not.toBeInTheDocument();
    });

    it("sends campus_id null for All campuses, with the form's other values", async () => {
      const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
      mockCreateCurriculum.mockResolvedValue(curriculumRecord());
      const { onOpenChange, user } = renderCreate();

      await pickClassAndSubject(user);
      const periods = screen.getByLabelText("Weekly periods");
      await user.clear(periods);
      await user.type(periods, "6");
      await save(user);

      await waitFor(() => {
        expect(mockCreateCurriculum).toHaveBeenCalledWith({
          academicSessionId: SESSION_ID,
          classId: CLASS_ID,
          subjectId: SUBJECT_ID,
          campusId: null,
          isElective: false,
          electiveGroup: null,
          weeklyPeriods: 6,
          notes: null,
        });
      });
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockToastSuccess).toHaveBeenCalledWith("Curriculum mapping saved.");
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["curriculum"] });
      // The load panel's periods come from the curriculum, so its summary goes stale too.
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["teacher-allocations", "load-summary", "list", {}],
      });
    });

    it("sends the campus when one is picked", async () => {
      mockCreateCurriculum.mockResolvedValue(curriculumRecord());
      const { user } = renderCreate();

      await pickClassAndSubject(user);
      await pick(user, "Campus", "Main Campus");
      await save(user);

      await waitFor(() => {
        expect(mockCreateCurriculum).toHaveBeenCalledWith(
          expect.objectContaining({ campusId: CAMPUS_ID }),
        );
      });
    });

    it("asks for the class and the subject, and sends nothing without them", async () => {
      const { user } = renderCreate();

      await save(user);

      expect(await screen.findAllByText("This field is required.")).toHaveLength(2);
      expect(mockCreateCurriculum).not.toHaveBeenCalled();
    });

    it("shows a field error for an elective without a group, then sends it once named", async () => {
      mockCreateCurriculum.mockResolvedValue(curriculumRecord());
      const { user } = renderCreate();

      await pickClassAndSubject(user);
      await user.click(screen.getByRole("switch", { name: "Elective subject" }));
      await save(user);

      expect(
        await screen.findByText("Enter a group name for an elective subject."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Elective group")).toHaveAttribute("aria-invalid", "true");
      expect(mockCreateCurriculum).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText("Elective group"), "Languages");
      await save(user);

      await waitFor(() => {
        expect(mockCreateCurriculum).toHaveBeenCalledWith(
          expect.objectContaining({ isElective: true, electiveGroup: "Languages" }),
        );
      });
    });

    it("asks for a whole number of periods when the field is cleared", async () => {
      const { user } = renderCreate();

      await pickClassAndSubject(user);
      await user.clear(screen.getByLabelText("Weekly periods"));
      await save(user);

      expect(await screen.findByText("Enter a whole number of at least 1.")).toBeInTheDocument();
      expect(mockCreateCurriculum).not.toHaveBeenCalled();
    });

    it("shows a duplicate (409) as the form's own message and stays open", async () => {
      const duplicate = "'Mathematics' is already mapped to 'Grade 1' for this session.";
      mockCreateCurriculum.mockRejectedValue(apiError(409, "conflict", "non_field", duplicate));
      const { onOpenChange, user } = renderCreate();

      await pickClassAndSubject(user);
      await save(user);

      expect(await screen.findByText(duplicate)).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Class" })).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("drops the form's message when the next attempt is made", async () => {
      const duplicate = "'Mathematics' is already mapped to 'Grade 1' for this session.";
      mockCreateCurriculum
        .mockRejectedValueOnce(apiError(409, "conflict", "non_field", duplicate))
        .mockResolvedValue(curriculumRecord());
      const { onOpenChange, user } = renderCreate();

      await pickClassAndSubject(user);
      await save(user);
      expect(await screen.findByText(duplicate)).toBeInTheDocument();
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockCreateCurriculum).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(duplicate)).not.toBeInTheDocument();
    });

    it("shows a 422 on weekly_periods under that field", async () => {
      const issue = "Weekly period targets must be at least 1.";
      mockCreateCurriculum.mockRejectedValue(
        apiError(422, "domain_rule_violation", "weekly_periods", issue),
      );
      const { user } = renderCreate();

      await pickClassAndSubject(user);
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(screen.getByLabelText("Weekly periods")).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
    });

    it("shows an error on a field the form has no input for as the form's own message", async () => {
      const issue = "Academic session '2026-27' is closed and cannot be modified.";
      mockCreateCurriculum.mockRejectedValue(
        apiError(422, "domain_rule_violation", "academic_session_id", issue),
      );
      const { user } = renderCreate();

      await pickClassAndSubject(user);
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
    });

    it("falls back to a generic message for a failure that isn't an API error", async () => {
      mockCreateCurriculum.mockRejectedValue(new TypeError("Failed to fetch"));
      const { user } = renderCreate();

      await pickClassAndSubject(user);
      await save(user);

      const message = await screen.findByText("Something went wrong. Please try again.");
      expect(message).toBeInTheDocument();
    });

    it("closes without saving on Cancel", async () => {
      const { onOpenChange, user } = renderCreate();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockCreateCurriculum).not.toHaveBeenCalled();
    });
  });

  describe("editing a mapping", () => {
    it("shows the session, class, subject and campus read-only, without fetching lists", async () => {
      renderEdit();

      const expected = {
        "Academic session": "2026-27",
        Class: "Grade 1",
        Subject: "Mathematics",
        Campus: "Main Campus",
      };
      for (const [field, value] of Object.entries(expected)) {
        const select = screen.getByRole("combobox", { name: field });
        expect(select).toBeDisabled();
        await waitFor(() => {
          expect(select).toHaveTextContent(value);
        });
      }
      expect(screen.getByLabelText("Weekly periods")).toHaveValue(5);
      expect(mockFetchClasses).not.toHaveBeenCalled();
      expect(mockFetchSubjects).not.toHaveBeenCalled();
      expect(mockFetchCampuses).not.toHaveBeenCalled();
    });

    it("shows a mapping for all campuses as such", async () => {
      renderEdit(curriculumRecord({ campus_id: null, campus_name: null }));

      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "Campus" })).toHaveTextContent("All campuses");
      });
    });

    it("sends only the four fields a mapping may change", async () => {
      mockUpdateCurriculum.mockResolvedValue(curriculumRecord());
      const { onOpenChange, user } = renderEdit();

      await user.click(screen.getByRole("switch", { name: "Elective subject" }));
      await user.type(screen.getByLabelText("Elective group"), "Languages");
      const periods = screen.getByLabelText("Weekly periods");
      await user.clear(periods);
      await user.type(periods, "6");
      await user.type(screen.getByLabelText("Notes"), "Choose one");
      await save(user);

      await waitFor(() => {
        expect(mockUpdateCurriculum).toHaveBeenCalledWith(RECORD_ID, {
          isElective: true,
          electiveGroup: "Languages",
          weeklyPeriods: 6,
          notes: "Choose one",
        });
      });
      expect(mockCreateCurriculum).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockToastSuccess).toHaveBeenCalledWith("Curriculum mapping saved.");
    });

    it("clears a stored group and notes by sending null when the subject is made core", async () => {
      mockUpdateCurriculum.mockResolvedValue(curriculumRecord());
      const elective = curriculumRecord({
        is_elective: true,
        elective_group: "Languages",
        notes: "Choose one",
      });
      const { user } = renderEdit(elective);

      await user.click(screen.getByRole("switch", { name: "Elective subject" }));
      await user.clear(screen.getByLabelText("Notes"));
      await save(user);

      await waitFor(() => {
        expect(mockUpdateCurriculum).toHaveBeenCalledWith(RECORD_ID, {
          isElective: false,
          electiveGroup: null,
          weeklyPeriods: 5,
          notes: null,
        });
      });
    });

    it("shows an error naming a field it doesn't edit as the form's own message", async () => {
      const issue = "Class 'Grade 1' is inactive.";
      mockUpdateCurriculum.mockRejectedValue(
        apiError(422, "domain_rule_violation", "class_id", issue),
      );
      const { onOpenChange, user } = renderEdit();

      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Class" })).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    describe("when the server refuses to leave an elective group short of options", () => {
      const issue = "Removing this leaves 'Languages' with no options.";
      const languages = curriculumRecord({ is_elective: true, elective_group: "Languages" });

      it("shows it as the form's own message once the switch is off, and stays open", async () => {
        mockUpdateCurriculum.mockRejectedValue(
          apiError(422, "domain_rule_violation", "elective_group", issue),
        );
        const { onOpenChange, user } = renderEdit(languages);

        await user.click(screen.getByRole("switch", { name: "Elective subject" }));
        await save(user);

        // The group input is gone, so this can only be the form-level message.
        expect(await screen.findByText(issue)).toBeInTheDocument();
        expect(screen.queryByLabelText("Elective group")).not.toBeInTheDocument();
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
        expect(mockToastSuccess).not.toHaveBeenCalled();
      });

      it("shows it under the group input while the switch is on", async () => {
        mockUpdateCurriculum.mockRejectedValue(
          apiError(422, "domain_rule_violation", "elective_group", issue),
        );
        const { onOpenChange, user } = renderEdit(languages);

        await save(user);

        expect(await screen.findByText(issue)).toBeInTheDocument();
        expect(screen.getByLabelText("Elective group")).toHaveAttribute("aria-invalid", "true");
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
      });
    });
  });
});
