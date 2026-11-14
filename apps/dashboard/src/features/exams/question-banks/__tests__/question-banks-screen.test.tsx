import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  bankPage,
  bankRecord,
  OTHER_BANK_ID,
  SUBJECT_ID,
} from "@/services/modules/question-banks/__tests__/question-banks-fixtures";
import { CLASS_ID } from "@/test-fixtures/academics";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { QuestionBanksTable } from "../question-banks-table";
import { QuestionBanksToolbar } from "../question-banks-toolbar";
import {
  asUser,
  createBank,
  deleteBank,
  fetchBanksPage,
  fetchSubjects,
  rowOf,
  stubQuestionBankServices,
  TEACHER_KEYS,
  updateBank,
  urlParam,
} from "./question-banks-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ questionBanksServicesMock: () => unknown }>("./question-banks-services-mock")
    .questionBanksServicesMock(),
);

/** A bank for every level, and one for a class. */
function twoBanks() {
  return bankPage([
    bankRecord(),
    bankRecord({
      id: OTHER_BANK_ID,
      name: "Grade 5 geometry",
      class_id: CLASS_ID,
      class_name: "Grade 5",
      status: "archived",
      question_count: 0,
    }),
  ]);
}

async function renderScreen() {
  renderWithProviders(
    <>
      <UserLoaded />
      <QuestionBanksToolbar />
      <QuestionBanksTable />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("question banks screen", () => {
  beforeEach(() => {
    stubQuestionBankServices();
    fetchBanksPage.mockResolvedValue(twoBanks());
  });

  it("lists each bank with its subject, class or every level, count and status", async () => {
    await renderScreen();

    await screen.findByText("Grade 5 geometry");
    const algebra = rowOf("Algebra basics");
    expect(algebra.getByText("Mathematics")).toBeInTheDocument();
    expect(algebra.getByText("Every level")).toBeInTheDocument();
    expect(algebra.getByText("3")).toBeInTheDocument();
    expect(algebra.getByText("Active")).toBeInTheDocument();
    expect(algebra.getByRole("link", { name: "Algebra basics" })).toHaveAttribute(
      "href",
      "/exams/question-banks/7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    );
    const geometry = rowOf("Grade 5 geometry");
    expect(geometry.getByText("Grade 5")).toBeInTheDocument();
    expect(geometry.getByText("Archived")).toBeInTheDocument();
  });

  it("offers no write to a viewer holding only the view key, nor the subject filter", async () => {
    await renderScreen();

    await screen.findByText("Algebra basics");
    expect(screen.queryByRole("button", { name: "New question bank" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Algebra basics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Algebra basics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Subject" })).not.toBeInTheDocument();
    expect(fetchSubjects).not.toHaveBeenCalled();
  });

  it("filters by subject and status through the URL", async () => {
    asUser("school.subject.view");
    const user = await renderScreen();
    await screen.findByText("Algebra basics");

    await user.click(screen.getByRole("combobox", { name: "Subject" }));
    await user.click(await screen.findByRole("option", { name: "Mathematics" }));

    await waitFor(() => {
      expect(urlParam("subject")).toBe(SUBJECT_ID);
    });
    expect(fetchBanksPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ subjectId: SUBJECT_ID }),
    );

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Archived" }));
    await waitFor(() => {
      expect(fetchBanksPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "archived" }),
      );
    });
  });

  it("creates a bank for every level", async () => {
    asUser(...TEACHER_KEYS, "school.subject.view", "school.class.view");
    createBank.mockResolvedValue(bankRecord());
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "New question bank" }));
    const dialog = await screen.findByRole("dialog", { name: "New question bank" });
    await user.type(within(dialog).getByLabelText("Name"), "Fractions");
    await user.click(await within(dialog).findByRole("combobox", { name: "Subject" }));
    await user.click(await screen.findByRole("option", { name: "Mathematics" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createBank).toHaveBeenCalledWith({
        name: "Fractions",
        subjectId: SUBJECT_ID,
        classId: null,
        description: null,
        status: "active",
      });
    });
  });

  it("shows the server's refusal under the field it names", async () => {
    asUser(...TEACHER_KEYS, "school.subject.view", "school.class.view");
    const issue = "A bank with this name already exists for this subject.";
    updateBank.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: "Validation failed.",
        url: "/question-banks",
        details: [{ field: "name", issue }],
      }),
    );
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Edit Algebra basics" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit this question bank" });
    await user.click(await within(dialog).findByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
    expect(updateBank).toHaveBeenCalledWith(
      "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      expect.objectContaining({ name: "Algebra basics", subjectId: SUBJECT_ID }),
    );
  });

  it("removes a bank after confirming", async () => {
    asUser(...TEACHER_KEYS);
    deleteBank.mockResolvedValue(undefined);
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Remove Algebra basics" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(deleteBank).toHaveBeenCalledWith("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
    });
  });

  it("says so when the list is empty", async () => {
    fetchBanksPage.mockResolvedValue(bankPage([]));
    await renderScreen();
    expect(await screen.findByText("No question banks yet")).toBeInTheDocument();
  });

  it("offers Try again when the list fails to load", async () => {
    fetchBanksPage.mockRejectedValue(new Error("network"));
    await renderScreen();
    expect(await screen.findByText("The question banks couldn't be loaded.")).toBeInTheDocument();
  });
});
