import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  aiDraftRecord,
  AI_QUESTION_ID,
  BANK_ID,
  questionRecord,
} from "@/services/modules/question-banks/__tests__/question-banks-fixtures";
import type { QuestionRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { QuestionFormDialog } from "../question-form-dialog";
import {
  createQuestion,
  stubQuestionBankServices,
  updateQuestion,
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

const onOpenChange = jest.fn();

function renderDialog(record?: QuestionRecord) {
  renderWithProviders(
    <QuestionFormDialog open onOpenChange={onOpenChange} bankId={BANK_ID} record={record} />,
  );
  return userEvent.setup();
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, label: string, name: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name }));
}

describe("QuestionFormDialog", () => {
  beforeEach(() => {
    stubQuestionBankServices();
    onOpenChange.mockReset();
    createQuestion.mockResolvedValue(questionRecord());
    updateQuestion.mockResolvedValue(questionRecord());
  });

  it("writes a multiple-choice question with its choices and the correct one", async () => {
    const user = renderDialog();

    await user.type(screen.getByLabelText("Question"), "Which is prime?");
    await pickOption(user, "Type", "Multiple choice");
    await user.type(screen.getByLabelText("Choices"), "4{Enter}7{Enter}9");
    await user.type(screen.getByLabelText("Answer"), "7");
    await user.type(screen.getByLabelText("Topic"), "Primes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createQuestion).toHaveBeenCalledWith(BANK_ID, {
        questionText: "Which is prime?",
        questionType: "mcq",
        difficulty: "medium",
        defaultMarks: "1.00",
        topic: "Primes",
        options: ["4", "7", "9"],
        answerKey: "7",
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refuses a multiple-choice question with one choice before sending it", async () => {
    const user = renderDialog();

    await user.type(screen.getByLabelText("Question"), "Which is prime?");
    await pickOption(user, "Type", "Multiple choice");
    await user.type(screen.getByLabelText("Choices"), "7");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Add at least two choices, one per line.")).toBeInTheDocument();
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it("answers a true-or-false question from its two choices", async () => {
    const user = renderDialog();

    await user.type(screen.getByLabelText("Question"), "The sun is a star.");
    await pickOption(user, "Type", "True or false");
    expect(screen.queryByLabelText("Choices")).not.toBeInTheDocument();
    await pickOption(user, "Answer", "True");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createQuestion).toHaveBeenCalledWith(
        BANK_ID,
        expect.objectContaining({ options: ["True", "False"], answerKey: "True" }),
      );
    });
  });

  it("edits an AI draft in place, its choices one per line", async () => {
    const user = renderDialog(aiDraftRecord());

    expect(screen.getByLabelText("Choices")).toHaveValue("4\n6\n7\n9");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateQuestion).toHaveBeenCalledWith(
        BANK_ID,
        AI_QUESTION_ID,
        expect.objectContaining({ questionType: "mcq", options: ["4", "6", "7", "9"] }),
      );
    });
  });

  it("asks for a model answer on a long-answer question", async () => {
    const user = renderDialog(questionRecord({ question_type: "long_answer", answer_key: null }));

    await user.type(screen.getByLabelText("Model answer"), "Photosynthesis makes sugar.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateQuestion).toHaveBeenCalledWith(
        BANK_ID,
        expect.any(String),
        expect.objectContaining({ answerKey: "Photosynthesis makes sugar.", options: null }),
      );
    });
  });

  it("shows the server's refusal under the field it names", async () => {
    const issue = "Options are a list of choices, in the order they should print.";
    updateQuestion.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: "Validation failed.",
        url: "/question-banks",
        details: [{ field: "options", issue }],
      }),
    );
    const user = renderDialog(aiDraftRecord());

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
