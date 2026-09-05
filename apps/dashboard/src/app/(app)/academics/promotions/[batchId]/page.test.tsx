import { render, screen } from "@testing-library/react";
import PromotionBatchPage from "./page";

jest.mock("@/features/academics/promotion-batch-review", () => ({
  PromotionBatchReview: ({ batchId }: { batchId: string }) => (
    <div data-testid="promotion-batch-review" data-batch-id={batchId} />
  ),
}));

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "promotions.review.title": "Promotion batch",
          "promotions.review.summary": "Review each student's decision before submitting.",
        })[key],
    ),
}));

describe("PromotionBatchPage", () => {
  it("resolves the batchId param and passes it to the review table", async () => {
    const ui = await PromotionBatchPage({ params: Promise.resolve({ batchId: "batch-1" }) });
    const { container } = render(ui);

    const review = screen.getByTestId("promotion-batch-review");
    expect(review).toHaveAttribute("data-batch-id", "batch-1");
    expect(screen.getByRole("heading", { level: 1, name: "Promotion batch" })).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
  });

  it("sets a static page title via metadata (no access token on the server to read the batch)", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Promotion batch");
  });
});
