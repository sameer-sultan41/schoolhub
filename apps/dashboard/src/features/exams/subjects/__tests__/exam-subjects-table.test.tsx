import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services, type ExamRecord } from "@/services";
import {
  CLASS_ID,
  OTHER_CLASS_ID,
  OTHER_SUBJECT_ID,
  subjectRecord,
} from "@/services/modules/exam-subjects/__tests__/exam-subjects-fixtures";
import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import { renderWithProviders } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import {
  asUser,
  createExamSubject,
  deleteExamSubject,
  fetchExamSubjects,
  mocked,
  pick,
  stubExamsServices,
} from "../../__tests__/exams-test-support";
import { ExamSubjectsTable } from "../exam-subjects-table";

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

const DUPLICATE = "This subject is already on the exam for this class.";
const FROZEN = "This exam is marks entry and its configuration is frozen.";

function apiError(status: number, code: string, issue: string, field?: string) {
  return new ApiError({
    code,
    message: issue,
    status,
    url: "/exam-subjects",
    details: field ? [{ field, issue }] : [],
  });
}

async function renderTable(exam: ExamRecord = examRecord()) {
  renderWithProviders(
    <>
      <UserLoaded />
      <ExamSubjectsTable exam={exam} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await pick(user, "Class", "Grade 5");
  await pick(user, "Subject", "Mathematics");
  await user.type(within(dialog).getByLabelText("Maximum marks"), "100");
  await user.type(within(dialog).getByLabelText("Pass marks"), "40");
}

describe("ExamSubjectsTable", () => {
  beforeEach(() => {
    stubExamsServices();
  });

  it("reads the whole of the exam's subjects, by its id", async () => {
    await renderTable();

    await screen.findByText("Mathematics");
    expect(fetchExamSubjects).toHaveBeenCalledWith(examRecord().id);
  });

  it("groups the subjects by class, each row with its marks, practical split and lock", async () => {
    fetchExamSubjects.mockResolvedValue([
      subjectRecord({
        has_practical: true,
        practical_max_marks: "30.00",
        practical_pass_marks: "12.00",
        subject_weightage_percent: "50.00",
        marks_locked_at: "2026-10-01T00:00:00Z",
      }),
      subjectRecord({ id: "x2", subject_id: OTHER_SUBJECT_ID, subject_name: "English" }),
      subjectRecord({
        id: "x3",
        class_id: OTHER_CLASS_ID,
        class_name: "Grade 6",
        subject_name: "Science",
      }),
    ]);

    await renderTable();

    expect(await screen.findByRole("heading", { name: "Grade 5" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Grade 6" })).toBeInTheDocument();
    const maths = (await screen.findByText("Mathematics")).closest("tr");
    if (!maths) throw new Error("rows not rendered");
    expect(within(maths).getByText("100.00")).toBeInTheDocument();
    expect(within(maths).getByText("40.00")).toBeInTheDocument();
    expect(within(maths).getByText("30.00 (pass 12.00)")).toBeInTheDocument();
    expect(within(maths).getByText("50.00%")).toBeInTheDocument();
    expect(within(maths).getByText("Locked")).toBeInTheDocument();
    const english = screen.getByText("English").closest("tr");
    if (!english) throw new Error("english row not rendered");
    expect(within(english).getByText("No practical")).toBeInTheDocument();
    expect(within(english).getByText("Open")).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });

  it("offers add, edit and remove to an updater while the exam is up to scheduled", async () => {
    asUser("exams.exam.update");

    await renderTable(examRecord({ status: "scheduled" }));

    expect(await screen.findByRole("button", { name: "Add subject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Mathematics in Grade 5" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Mathematics from Grade 5" }),
    ).toBeInTheDocument();
  });

  it.each(["ongoing", "marks_entry", "published", "archived"] as const)(
    "is read-only on a %s exam, even for an updater",
    async (status) => {
      asUser("exams.exam.update");

      await renderTable(examRecord({ status }));

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add subject" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^(Edit|Remove) / })).not.toBeInTheDocument();
    },
  );

  it("is read-only for a viewer holding only the view key", async () => {
    await renderTable();

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add subject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Edit|Remove) / })).not.toBeInTheDocument();
  });

  it("says there are no subjects yet, and what to do about it", async () => {
    asUser("exams.exam.update");
    fetchExamSubjects.mockResolvedValue([]);

    await renderTable();

    expect(await screen.findByText("No subjects yet")).toBeInTheDocument();
    expect(
      screen.getByText("Add the subjects each class sits, with their marks."),
    ).toBeInTheDocument();
  });

  describe("the add dialog", () => {
    beforeEach(() => {
      asUser("exams.exam.update");
    });

    it("shows the practical maximum and pass marks only while the subject has a practical part", async () => {
      const user = await renderTable();

      await user.click(await screen.findByRole("button", { name: "Add subject" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).queryByLabelText("Practical maximum")).not.toBeInTheDocument();
      expect(within(dialog).queryByLabelText("Practical pass marks")).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole("switch", { name: "Has a practical component" }));
      expect(within(dialog).getByLabelText("Practical maximum")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Practical pass marks")).toBeInTheDocument();

      await user.click(within(dialog).getByRole("switch", { name: "Has a practical component" }));
      expect(within(dialog).queryByLabelText("Practical maximum")).not.toBeInTheDocument();
    });

    it("asks for the practical maximum before sending a subject with a practical part", async () => {
      const user = await renderTable();

      await user.click(await screen.findByRole("button", { name: "Add subject" }));
      const dialog = await screen.findByRole("dialog");
      await fillRequired(user, dialog);
      await user.click(within(dialog).getByRole("switch", { name: "Has a practical component" }));
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
      expect(createExamSubject).not.toHaveBeenCalled();
    });

    it("offers the subjects on the picked class's curriculum for the exam's session", async () => {
      const user = await renderTable();

      await user.click(await screen.findByRole("button", { name: "Add subject" }));
      await screen.findByRole("dialog");
      await pick(user, "Class", "Grade 5");

      await waitFor(() => {
        expect(mocked(Services.curriculum.fetchCurriculumForClass)).toHaveBeenCalledWith(
          examRecord().academic_session_id,
          CLASS_ID,
        );
      });
      await user.click(screen.getByRole("combobox", { name: "Subject" }));
      expect(await screen.findByRole("option", { name: "Mathematics" })).toBeInTheDocument();
    });

    it("sends the new subject for this exam", async () => {
      createExamSubject.mockResolvedValue(subjectRecord());
      const user = await renderTable();

      await user.click(await screen.findByRole("button", { name: "Add subject" }));
      const dialog = await screen.findByRole("dialog");
      await fillRequired(user, dialog);
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(createExamSubject).toHaveBeenCalledWith(
          expect.objectContaining({
            examId: examRecord().id,
            classId: CLASS_ID,
            maxMarks: "100",
            passMarks: "40",
            hasPractical: false,
            practicalMaxMarks: null,
          }),
        );
      });
    });

    it("puts the server's duplicate (exam, class, subject) refusal under Subject and keeps the dialog open", async () => {
      createExamSubject.mockRejectedValue(
        apiError(422, "validation_error", DUPLICATE, "subject_id"),
      );
      const user = await renderTable();

      await user.click(await screen.findByRole("button", { name: "Add subject" }));
      const dialog = await screen.findByRole("dialog");
      await fillRequired(user, dialog);
      const reads = fetchExamSubjects.mock.calls.length;
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await within(dialog).findByText(DUPLICATE)).toBeInTheDocument();
      // A field refusal is the form's to show: only a 409 means the exam moved on and reloads it.
      expect(fetchExamSubjects).toHaveBeenCalledTimes(reads);
      expect(within(dialog).getByRole("combobox", { name: "Subject" })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("shows the server's own sentence when the exam moved past scheduled meanwhile", async () => {
      createExamSubject.mockRejectedValue(apiError(409, "conflict", FROZEN));
      const user = await renderTable();

      await user.click(await screen.findByRole("button", { name: "Add subject" }));
      const dialog = await screen.findByRole("dialog");
      await fillRequired(user, dialog);
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await within(dialog).findByText(FROZEN)).toBeInTheDocument();
    });
  });

  it("starts an edit from the row, class and subject locked, practical marks shown", async () => {
    asUser("exams.exam.update");
    fetchExamSubjects.mockResolvedValue([
      subjectRecord({
        has_practical: true,
        practical_max_marks: "30.00",
        practical_pass_marks: "12.00",
      }),
    ]);
    const user = await renderTable();

    await user.click(await screen.findByRole("button", { name: "Edit Mathematics in Grade 5" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Practical maximum")).toHaveValue("30.00");
    expect(within(dialog).getByRole("combobox", { name: "Class" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Subject" })).toBeDisabled();
  });

  it("removes a subject after a confirm", async () => {
    asUser("exams.exam.update");
    deleteExamSubject.mockResolvedValue(undefined);
    const user = await renderTable();

    await user.click(
      await screen.findByRole("button", { name: "Remove Mathematics from Grade 5" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(deleteExamSubject).toHaveBeenCalledWith(subjectRecord().id);
    });
  });
});
