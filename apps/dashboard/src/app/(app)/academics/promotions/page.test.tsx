import { render, screen } from "@testing-library/react";
import AcademicsPromotionsPage from "./page";

jest.mock("@/features/academics/promotion-batches-screen", () => ({
  PromotionBatchesScreen: () => <div data-testid="promotion-batches-screen" />,
}));

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "promotions.title": "Promotions",
          "promotions.summary": "Session-end promotion batches, per class.",
        })[key],
    ),
}));

describe("AcademicsPromotionsPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await AcademicsPromotionsPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Promotions" })).toBeInTheDocument();
    expect(screen.getByText("Session-end promotion batches, per class.")).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("promotion-batches-screen")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Promotions");
  });
});
