import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { BATCH_ID } from "@/services/modules/promotions/__tests__/promotions-fixtures";

import PromotionBatchPage from "../page";

// Next's `notFound()` throws to stop the render; here it throws something a test can name.
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// The shell's container reads the viewer's layout preference, and the review its own queries:
// the route's own job is what is under test.
jest.mock("@/app/(app)/shell/partials/common/container", () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock("@/features/academics/promotions/promotion-batch-review", () => ({
  PromotionBatchReview: ({ batchId }: { batchId: string }) => <p>{`reviewing ${batchId}`}</p>,
}));

const mockNotFound = notFound as jest.MockedFunction<typeof notFound>;

/** Not a UUID, so no batch: too short, too long, or not hex at all. */
const INVALID_IDS = ["not-a-uuid", "123", `${BATCH_ID}0`, BATCH_ID.slice(1)];

function paramsOf(batchId: string) {
  return { params: Promise.resolve({ batchId }) };
}

describe("the promotion batch route", () => {
  it("reviews the batch its URL names", async () => {
    render(await PromotionBatchPage(paramsOf(BATCH_ID)));

    expect(screen.getByText(`reviewing ${BATCH_ID}`)).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("accepts an upper-case id", async () => {
    render(await PromotionBatchPage(paramsOf(BATCH_ID.toUpperCase())));

    expect(screen.getByText(`reviewing ${BATCH_ID.toUpperCase()}`)).toBeInTheDocument();
  });

  it.each(INVALID_IDS)("is a 404 for %s", async (batchId) => {
    await expect(PromotionBatchPage(paramsOf(batchId))).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });
});
