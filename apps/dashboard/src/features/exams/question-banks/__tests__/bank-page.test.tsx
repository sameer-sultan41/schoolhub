import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import {
  AI_QUESTION_ID,
  aiDraftRecord,
  BANK_ID,
  QUESTION_ID,
  questionPage,
  questionRecord,
} from "@/services/modules/question-banks/__tests__/question-banks-fixtures";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { BankPage } from "../bank-page";
import {
  approveQuestion,
  asUser,
  deleteQuestion,
  fetchBank,
  fetchQuestionsPage,
  rowOf,
  stubQuestionBankServices,
  TEACHER_KEYS,
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

const APPROVED_DRAFT = aiDraftRecord({
  id: "4b8c9d0e-1f2a-4b3c-8d4e-6f708192a3b4",
  question_text: "Name the largest planet.",
  is_approved: true,
  approved_by: "5c9d0e1f-2a3b-4c4d-9e5f-708192a3b4c5",
  approved_by_name: "Sana Malik",
});

async function renderPage() {
  renderWithProviders(
    <>
      <UserLoaded />
      <BankPage bankId={BANK_ID} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("a question bank's page", () => {
  beforeEach(() => {
    stubQuestionBankServices(`/exams/question-banks/${BANK_ID}`);
    fetchQuestionsPage.mockResolvedValue(
      questionPage([questionRecord(), aiDraftRecord(), APPROVED_DRAFT]),
    );
  });

  it("heads the page with the bank's subject, level and count, then its questions", async () => {
    await renderPage();

    expect(await screen.findByRole("heading", { name: "Algebra basics" })).toBeInTheDocument();
    expect(screen.getByText("Every level")).toBeInTheDocument();
    expect(screen.getByText("3 questions")).toBeInTheDocument();
    const manual = rowOf("Solve 2x + 3 = 7.");
    expect(manual.getByText("Short answer")).toBeInTheDocument();
    expect(manual.getByText("Written by staff")).toBeInTheDocument();
    expect(manual.getByText("Approved")).toBeInTheDocument();
  });

  it("labels an AI draft, and keeps who approved one once it is approved", async () => {
    await renderPage();

    await screen.findByText(aiDraftRecord().question_text);
    const draft = rowOf(aiDraftRecord().question_text);
    expect(draft.getByText("AI-generated")).toBeInTheDocument();
    expect(draft.getByText("Awaiting approval")).toBeInTheDocument();
    const approved = rowOf("Name the largest planet.");
    expect(approved.getByText("AI-generated")).toBeInTheDocument();
    expect(approved.getByText("Approved by Sana Malik")).toBeInTheDocument();
  });

  it("offers Approve only on an unapproved AI draft, to a holder of the approve key", async () => {
    asUser("exams.question.approve");
    await renderPage();

    await screen.findByText("Name the largest planet.");
    const approveButtons = screen.getAllByRole("button", { name: /^Approve the question/ });
    expect(approveButtons).toHaveLength(1);
    expect(
      rowOf(aiDraftRecord().question_text).getByRole("button", { name: /^Approve the question/ }),
    ).toBeInTheDocument();
    expect(rowOf("Solve 2x + 3 = 7.").queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers no Approve without the approve key, whoever wrote the draft", async () => {
    asUser("exams.question-bank.update");
    await renderPage();

    await screen.findByText(aiDraftRecord().question_text);
    expect(screen.queryByRole("button", { name: /^Approve the question/ })).not.toBeInTheDocument();
  });

  it("shows the whole draft before approving, and sends nothing until Confirm", async () => {
    asUser("exams.question.approve");
    approveQuestion.mockResolvedValue(aiDraftRecord({ is_approved: true }));
    const user = await renderPage();
    await screen.findByText(aiDraftRecord().question_text);
    const reads = fetchQuestionsPage.mock.calls.length;

    await user.click(screen.getByRole("button", { name: /^Approve the question/ }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Which of these is a prime number?")).toBeInTheDocument();
    expect(dialog.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "4",
      "6",
      "7",
      "9",
    ]);
    expect(dialog.getByText("Answer key").nextSibling).toHaveTextContent("7");
    expect(dialog.getByText("2.00")).toBeInTheDocument();
    expect(dialog.getByText("Linear equations")).toBeInTheDocument();
    expect(dialog.getByText(/approval cannot be undone/)).toBeInTheDocument();
    expect(approveQuestion).not.toHaveBeenCalled();

    await user.click(dialog.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(approveQuestion).toHaveBeenCalledWith(BANK_ID, AI_QUESTION_ID);
    });
    expect(toast.success).toHaveBeenCalledWith("Question approved: papers can now use it.");
    await waitFor(() => {
      expect(fetchQuestionsPage.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("sends nothing when the approval is cancelled", async () => {
    asUser("exams.question.approve");
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: /^Approve the question/ }));
    const dialog = within(await screen.findByRole("alertdialog"));
    await user.click(dialog.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(approveQuestion).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of an approval in the dialog", async () => {
    asUser("exams.question.approve");
    approveQuestion.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "conflict",
        message: "Only AI-generated questions go through approval.",
        url: "/question-banks",
      }),
    );
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: /^Approve the question/ }));
    const dialog = within(await screen.findByRole("alertdialog"));
    await user.click(dialog.getByRole("button", { name: "Approve" }));

    expect(await dialog.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("filters by topic on Enter, and by difficulty, through the URL", async () => {
    const user = await renderPage();
    await screen.findByText("Solve 2x + 3 = 7.");

    const topicBox = screen.getByRole("textbox", { name: "Topic" });
    await user.type(topicBox, "Linear equations{Enter}");
    await waitFor(() => {
      expect(urlParam("topic")).toBe("Linear equations");
    });
    // The box resyncs to the URL without a remount, so typing keeps its focus.
    expect(screen.getByRole("textbox", { name: "Topic" })).toBe(topicBox);
    expect(topicBox).toHaveFocus();
    expect(fetchQuestionsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ bankId: BANK_ID, topic: "Linear equations" }),
    );

    await user.click(screen.getByRole("combobox", { name: "Difficulty" }));
    await user.click(await screen.findByRole("option", { name: "Hard" }));
    await waitFor(() => {
      expect(fetchQuestionsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ difficulty: "hard", topic: "Linear equations" }),
      );
    });

    await user.click(screen.getByRole("combobox", { name: "Approval" }));
    await user.click(await screen.findByRole("option", { name: "Awaiting approval" }));
    await waitFor(() => {
      expect(fetchQuestionsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ isApproved: false }),
      );
    });
  });

  it("removes a question after confirming", async () => {
    asUser(...TEACHER_KEYS);
    deleteQuestion.mockResolvedValue(undefined);
    const user = await renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Remove the question Solve 2x + 3 = 7." }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(deleteQuestion).toHaveBeenCalledWith(BANK_ID, QUESTION_ID);
    });
  });

  it("offers the bank's writes to a holder of the keys, and none to a reader", async () => {
    asUser(...TEACHER_KEYS);
    await renderPage();

    await screen.findByRole("heading", { name: "Algebra basics" });
    for (const name of ["New question", "Assemble paper", "Edit", "Remove"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("says a bank it can't find is not found, with a way back", async () => {
    fetchBank.mockRejectedValue(
      new ApiError({ status: 404, code: "not_found", message: "Not found.", url: "/questions" }),
    );
    await renderPage();

    expect(await screen.findByText("Question bank not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to question banks" })).toHaveAttribute(
      "href",
      "/exams/question-banks",
    );
  });

  it("offers Try again when the bank fails to load for another reason", async () => {
    fetchBank.mockRejectedValue(new Error("network"));
    await renderPage();

    expect(await screen.findByText("The question bank couldn't be loaded.")).toBeInTheDocument();
  });
});
