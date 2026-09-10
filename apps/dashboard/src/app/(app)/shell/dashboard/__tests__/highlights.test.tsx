import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { Services } from "@/services";
import { Highlights } from "../highlights";

jest.mock("@/services", () => ({
  Services: { dashboard: { fetchDashboardOverview: jest.fn() } },
}));

const mockFetchDashboardOverview = Services.dashboard.fetchDashboardOverview as jest.MockedFunction<
  typeof Services.dashboard.fetchDashboardOverview
>;

describe("Highlights", () => {
  beforeEach(() => {
    mockFetchDashboardOverview.mockReset();
  });

  it("shows a skeleton while the overview is in flight", () => {
    mockFetchDashboardOverview.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<Highlights limit={3} />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows the enrolled-students headline and caps the row list at `limit`", async () => {
    mockFetchDashboardOverview.mockResolvedValue({
      students: 1280,
      staff: 97,
      classes: 12,
      sections: 34,
      subjects: 8,
      campuses: 3,
    });

    renderWithProviders(<Highlights limit={2} />);

    expect(await screen.findByText("1,280")).toBeInTheDocument();
    // Only the first two rows (Classes, Staff) render — Campuses is cut by limit={2}.
    expect(screen.getByText("Classes")).toBeInTheDocument();
    expect(screen.getByText("Staff")).toBeInTheDocument();
    expect(screen.queryByText("Campuses")).not.toBeInTheDocument();
  });

  it("omits the segmented bar rather than dividing by zero when every segment is empty", async () => {
    mockFetchDashboardOverview.mockResolvedValue({
      students: 0,
      staff: 0,
      classes: 0,
      sections: 0,
      subjects: 0,
      campuses: 0,
    });

    const { container } = renderWithProviders(<Highlights limit={3} />);

    await screen.findByText("Reference Overview");
    // The bar segments are the only elements with an inline width style — the legend
    // (BadgeDot + label) below them stays regardless, so a class-based query would
    // match both and prove nothing.
    expect(container.querySelectorAll('div[style*="width"]')).toHaveLength(0);
  });
});
