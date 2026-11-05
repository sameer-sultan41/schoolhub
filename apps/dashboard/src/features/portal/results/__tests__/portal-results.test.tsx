import { screen } from "@testing-library/react";

import { Services } from "@/services";
import { AYESHA_ID, portalDashboard, portalResult } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalResults } from "../portal-results";

const mockUseParams = jest.fn();

jest.mock("next/navigation", () => ({
  useParams: () => mockUseParams() as unknown,
}));

jest.mock("@/services", () => ({
  Services: {
    parentPortal: { fetchPortalDashboard: jest.fn() },
    results: { listResults: jest.fn() },
  },
}));

const mockFetchDashboard = Services.parentPortal.fetchPortalDashboard as jest.MockedFunction<
  typeof Services.parentPortal.fetchPortalDashboard
>;

const mockListResults = Services.results.listResults as jest.MockedFunction<
  typeof Services.results.listResults
>;

describe("PortalResults", () => {
  beforeEach(() => {
    mockListResults.mockReset();
    mockUseParams.mockReturnValue({ studentId: AYESHA_ID });
    mockFetchDashboard.mockResolvedValue(portalDashboard());
  });

  it("a student id that is not one of the viewer's children is not found, and never fetched", async () => {
    mockUseParams.mockReturnValue({ studentId: "99999999-9999-4999-8999-999999999999" });

    renderWithProviders(<PortalResults />);

    expect(await screen.findByText("Child not found")).toBeInTheDocument();
    expect(mockListResults).not.toHaveBeenCalled();
  });

  it("results lists only what the API returns", async () => {
    mockListResults.mockResolvedValue({
      items: [
        portalResult(),
        portalResult({
          id: "66666666-6666-4666-8666-000000000002",
          exam_name: "Finals",
          term_name: null,
          percentage: "40.00",
          grade: "F",
          outcome: "fail",
          rank_in_section: null,
          published_at: "2026-06-20T09:00:00Z",
        }),
      ],
    });

    renderWithProviders(<PortalResults />);

    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Mid-term")).toBeInTheDocument();
    expect(screen.getByText("Finals")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Term 1" })).toBeInTheDocument();
    expect(screen.getByText("81.5%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(mockListResults).toHaveBeenCalledWith(expect.objectContaining({ studentId: AYESHA_ID }));
  });

  it("says so when no result is published", async () => {
    mockListResults.mockResolvedValue({ items: [] });

    renderWithProviders(<PortalResults />);

    expect(await screen.findByText("No results published")).toBeInTheDocument();
  });

  it("offers a retry when the results fail to load", async () => {
    mockListResults.mockRejectedValue(new Error("boom"));

    renderWithProviders(<PortalResults />);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
