import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { Services } from "@/services";
import { EarningsChart } from "../earnings-chart";

jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchAcademicSessions: jest.fn(), fetchTeacherLoadSummary: jest.fn() },
  },
}));

// apexcharts manipulates the DOM/canvas far more than jsdom can support; the widget's
// own job — resolving the session, sorting/capping the rows, choosing empty vs. loaded
// vs. pending — is what's under test here, not the chart library's own rendering.
jest.mock("react-apexcharts", () => ({
  __esModule: true,
  default: function MockApexChart({ series }: { series: { name: string; data: number[] }[] }) {
    return <div data-testid="apex-chart">{JSON.stringify(series[0]?.data)}</div>;
  },
}));

const mockFetchAcademicSessions = Services.dashboard.fetchAcademicSessions as jest.MockedFunction<
  typeof Services.dashboard.fetchAcademicSessions
>;
const mockFetchTeacherLoadSummary = Services.dashboard
  .fetchTeacherLoadSummary as jest.MockedFunction<typeof Services.dashboard.fetchTeacherLoadSummary>;

const CURRENT_SESSION = { id: "sess-1", name: "2026-27", status: "active", is_current: true };

describe("EarningsChart", () => {
  beforeEach(() => {
    mockFetchAcademicSessions.mockReset();
    mockFetchTeacherLoadSummary.mockReset();
  });

  it("shows a skeleton while the session/load queries are in flight", () => {
    mockFetchAcademicSessions.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<EarningsChart />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("apex-chart")).not.toBeInTheDocument();
  });

  it("resolves the current session, then charts the load sorted heaviest first", async () => {
    mockFetchAcademicSessions.mockResolvedValue([CURRENT_SESSION]);
    mockFetchTeacherLoadSummary.mockResolvedValue([
      { staff_id: "a", name: "Ayesha Khan", weekly_periods: 18, allocations: 4, over_norm: false },
      { staff_id: "b", name: "Bilal Ahmed", weekly_periods: 26, allocations: 5, over_norm: true },
    ]);

    renderWithProviders(<EarningsChart />);

    expect(await screen.findByTestId("apex-chart")).toHaveTextContent("[26,18]");
    expect(mockFetchTeacherLoadSummary).toHaveBeenCalledWith("sess-1");
  });

  it("says no load is recorded rather than rendering an empty chart", async () => {
    mockFetchAcademicSessions.mockResolvedValue([CURRENT_SESSION]);
    mockFetchTeacherLoadSummary.mockResolvedValue([]);

    renderWithProviders(<EarningsChart />);

    expect(
      await screen.findByText("No teaching load recorded for the current session."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("apex-chart")).not.toBeInTheDocument();
  });
});
