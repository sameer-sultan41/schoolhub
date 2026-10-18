import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { queryKeys } from "@/lib/query-client";
import { renderWithProviders } from "@/test-utils";
import { Services } from "@/services";
import { EarningsChart } from "../earnings-chart";

jest.mock("@/services", () => ({
  Services: {
    schoolOrganization: { fetchAcademicSessions: jest.fn() },
    teacherAllocations: { fetchLoadSummary: jest.fn() },
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

const mockFetchAcademicSessions = Services.schoolOrganization
  .fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;
const mockFetchLoadSummary = Services.teacherAllocations.fetchLoadSummary as jest.MockedFunction<
  typeof Services.teacherAllocations.fetchLoadSummary
>;

// `as const`: the generated session status is a union, which a widened `string` isn't.
const CURRENT_SESSION = {
  id: "sess-1",
  name: "2026-27",
  status: "active" as const,
  is_current: true,
};

describe("EarningsChart", () => {
  beforeEach(() => {
    mockFetchAcademicSessions.mockReset();
    mockFetchLoadSummary.mockReset();
  });

  it("shows a skeleton while the session/load queries are in flight", () => {
    mockFetchAcademicSessions.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<EarningsChart />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("apex-chart")).not.toBeInTheDocument();
  });

  it("resolves the current session, then charts the load sorted heaviest first", async () => {
    mockFetchAcademicSessions.mockResolvedValue([CURRENT_SESSION]);
    mockFetchLoadSummary.mockResolvedValue([
      {
        staff_id: "a",
        name: "Ayesha Khan",
        weekly_periods: 18,
        allocations: 4,
        norm: 30,
        over_norm: false,
      },
      {
        staff_id: "b",
        name: "Bilal Ahmed",
        weekly_periods: 36,
        allocations: 5,
        norm: 30,
        over_norm: true,
      },
    ]);

    renderWithProviders(<EarningsChart />);

    expect(await screen.findByTestId("apex-chart")).toHaveTextContent("[36,18]");
    expect(mockFetchLoadSummary).toHaveBeenCalledWith("sess-1");
  });

  // The allocations screen's load panel reads this same key, so its invalidation of
  // `teacher-allocations` refreshes the widget.
  it("holds its load under the key the allocations screen shares", async () => {
    const rows = [
      {
        staff_id: "a",
        name: "Ayesha Khan",
        weekly_periods: 18,
        allocations: 4,
        norm: 30,
        over_norm: false,
      },
    ];
    mockFetchAcademicSessions.mockResolvedValue([CURRENT_SESSION]);
    mockFetchLoadSummary.mockResolvedValue(rows);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <EarningsChart />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("apex-chart")).toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        queryKeys.list("teacher-allocations", "load-summary", { sessionId: CURRENT_SESSION.id }),
      ),
    ).toEqual(rows);
  });

  it("says no load is recorded rather than rendering an empty chart", async () => {
    mockFetchAcademicSessions.mockResolvedValue([CURRENT_SESSION]);
    mockFetchLoadSummary.mockResolvedValue([]);

    renderWithProviders(<EarningsChart />);

    expect(
      await screen.findByText("No teaching load recorded for the current session."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("apex-chart")).not.toBeInTheDocument();
  });

  it("shows the error's own message rather than an empty chart when the session fetch fails", async () => {
    mockFetchAcademicSessions.mockRejectedValue(new Error("sessions unreachable"));

    renderWithProviders(<EarningsChart />);

    expect(await screen.findByText("sessions unreachable")).toBeInTheDocument();
    expect(screen.queryByTestId("apex-chart")).not.toBeInTheDocument();
  });
});
