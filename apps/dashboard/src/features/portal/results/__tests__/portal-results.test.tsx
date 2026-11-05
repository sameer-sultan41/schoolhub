import { screen } from "@testing-library/react";

import { Services } from "@/services";
import { AYESHA_ID, portalResult } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalResults } from "../portal-results";

jest.mock("next/navigation", () => ({
  useParams: () => ({ studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
}));

jest.mock("@/services", () => ({
  Services: { results: { listResults: jest.fn() } },
}));

const mockListResults = Services.results.listResults as jest.MockedFunction<
  typeof Services.results.listResults
>;

describe("PortalResults", () => {
  beforeEach(() => {
    mockListResults.mockReset();
  });

  it("results lists only what the API returns", async () => {
    mockListResults.mockResolvedValue({
      items: [
        portalResult(),
        portalResult({
          id: "66666666-6666-4666-8666-000000000002",
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
