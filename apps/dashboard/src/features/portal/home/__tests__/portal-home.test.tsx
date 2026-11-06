import { screen } from "@testing-library/react";

import { Services } from "@/services";
import { AYESHA_ID, BILAL_ID, portalChild, portalDashboard } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { ChildOverview } from "../child-overview";
import { PortalHome } from "../portal-home";

const mockUseParams = jest.fn();

jest.mock("next/navigation", () => ({
  useParams: () => mockUseParams() as unknown,
}));

jest.mock("@/services", () => ({
  Services: { parentPortal: { fetchPortalDashboard: jest.fn() } },
}));

const mockFetchDashboard = Services.parentPortal.fetchPortalDashboard as jest.MockedFunction<
  typeof Services.parentPortal.fetchPortalDashboard
>;

describe("PortalHome", () => {
  beforeEach(() => {
    mockFetchDashboard.mockReset();
    mockUseParams.mockReturnValue({});
  });

  it("home omits null cards", async () => {
    mockFetchDashboard.mockResolvedValue(
      portalDashboard({
        children: [
          portalChild(AYESHA_ID, "Ayesha", "Khan", { fees: null, latest_result: null }),
          portalChild(BILAL_ID, "Bilal", "Khan", { attendance: null }),
        ],
      }),
    );

    renderWithProviders(<PortalHome />);

    expect(await screen.findByText("Ayesha Khan")).toBeInTheDocument();
    expect(screen.getByText("Bilal Khan")).toBeInTheDocument();
    // Ayesha has no fees or result card, Bilal no attendance card: one of each remains.
    expect(screen.getAllByText("Attendance today")).toHaveLength(1);
    expect(screen.getAllByText("Fees outstanding")).toHaveLength(1);
    expect(screen.getAllByText("Latest result")).toHaveLength(1);
  });

  it("says so when no child is linked", async () => {
    mockFetchDashboard.mockResolvedValue(portalDashboard({ children: [] }));

    renderWithProviders(<PortalHome />);

    expect(await screen.findByText("No children linked yet")).toBeInTheDocument();
  });

  it("shows the selected child's card on the overview", async () => {
    mockUseParams.mockReturnValue({ studentId: BILAL_ID });
    mockFetchDashboard.mockResolvedValue(portalDashboard());

    renderWithProviders(<ChildOverview />);

    expect(await screen.findByText("Bilal Khan")).toBeInTheDocument();
    expect(screen.queryByText("Ayesha Khan")).not.toBeInTheDocument();
  });

  it("says a segment that is not the viewer's child was not found", async () => {
    mockUseParams.mockReturnValue({ studentId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    mockFetchDashboard.mockResolvedValue(portalDashboard());

    renderWithProviders(<ChildOverview />);

    expect(await screen.findByText("Child not found")).toBeInTheDocument();
  });
});
