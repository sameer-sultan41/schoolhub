import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { Services } from "@/services";
import { ChannelStats } from "../channel-stats";

jest.mock("@/services", () => ({
  Services: { dashboard: { fetchDashboardOverview: jest.fn() } },
}));

const mockFetchDashboardOverview = Services.dashboard.fetchDashboardOverview as jest.MockedFunction<
  typeof Services.dashboard.fetchDashboardOverview
>;

describe("ChannelStats", () => {
  beforeEach(() => {
    mockFetchDashboardOverview.mockReset();
  });

  it("shows a skeleton card per stat while the overview is in flight", () => {
    mockFetchDashboardOverview.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<ChannelStats />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("Enrolled students")).not.toBeInTheDocument();
  });

  it("renders the four real counts once the overview loads", async () => {
    mockFetchDashboardOverview.mockResolvedValue({
      students: 1280,
      staff: 97,
      classes: 12,
      sections: 34,
      subjects: 8,
      campuses: 3,
    });

    renderWithProviders(<ChannelStats />);

    expect(await screen.findByText("1,280")).toBeInTheDocument();
    expect(screen.getByText("97")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Enrolled students")).toBeInTheDocument();
    expect(screen.getByText("Campuses")).toBeInTheDocument();
  });

  it("shows an em dash rather than a fabricated zero when a total is unavailable", async () => {
    mockFetchDashboardOverview.mockResolvedValue({
      students: null,
      staff: null,
      classes: 12,
      sections: 34,
      subjects: 8,
      campuses: 3,
    });

    renderWithProviders(<ChannelStats />);

    expect(await screen.findAllByText("—")).toHaveLength(2);
  });
});
