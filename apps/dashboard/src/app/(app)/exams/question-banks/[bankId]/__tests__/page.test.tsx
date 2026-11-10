import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { BANK_ID } from "@/services/modules/question-banks/__tests__/question-banks-fixtures";

import QuestionBankDetailPage from "../page";

// Next's `notFound()` throws to stop the render; here it throws something a test can name.
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// The shell's container reads the viewer's layout preference, and the page its own queries:
// the route's own job is what is under test.
jest.mock("@/app/(app)/shell/partials/common/container", () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock("@/features/exams/question-banks/bank-page", () => ({
  BankPage: ({ bankId }: { bankId: string }) => <p>{`bank ${bankId}`}</p>,
}));

const mockNotFound = notFound as jest.MockedFunction<typeof notFound>;

/** Not a UUID, so no bank: too short, too long, or not hex at all. */
const INVALID_IDS = ["not-a-uuid", `${BANK_ID}0`, BANK_ID.slice(1)];

function paramsOf(bankId: string) {
  return { params: Promise.resolve({ bankId }) };
}

describe("the question bank route", () => {
  beforeEach(() => {
    mockNotFound.mockClear();
  });

  it("shows the bank its URL names", async () => {
    render(await QuestionBankDetailPage(paramsOf(BANK_ID)));

    expect(screen.getByText(`bank ${BANK_ID}`)).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it.each(INVALID_IDS)("is a 404 for %s", async (bankId) => {
    await expect(QuestionBankDetailPage(paramsOf(bankId))).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });
});
