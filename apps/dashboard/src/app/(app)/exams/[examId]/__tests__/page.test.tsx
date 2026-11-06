import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { EXAM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";

import ExamDetailPage from "../page";

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
jest.mock("@/features/exams/detail/exam-page", () => ({
  ExamPage: ({ examId }: { examId: string }) => <p>{`exam ${examId}`}</p>,
}));

const mockNotFound = notFound as jest.MockedFunction<typeof notFound>;

/** Not a UUID, so no exam: too short, too long, or not hex at all. */
const INVALID_IDS = ["not-a-uuid", "grading-scales-2", `${EXAM_ID}0`, EXAM_ID.slice(1)];

function paramsOf(examId: string) {
  return { params: Promise.resolve({ examId }) };
}

describe("the exam route", () => {
  beforeEach(() => {
    mockNotFound.mockClear();
  });

  it("shows the exam its URL names", async () => {
    render(await ExamDetailPage(paramsOf(EXAM_ID)));

    expect(screen.getByText(`exam ${EXAM_ID}`)).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it.each(INVALID_IDS)("is a 404 for %s", async (examId) => {
    await expect(ExamDetailPage(paramsOf(examId))).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });
});
