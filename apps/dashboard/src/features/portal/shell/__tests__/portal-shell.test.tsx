import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  ALL_MODULES_ON,
  AYESHA_ID,
  BILAL_ID,
  portalChild,
  portalDashboard,
} from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalShell } from "../portal-shell";

const mockPush = jest.fn();
const mockUseParams = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => `/portal/${AYESHA_ID}`,
  useParams: () => mockUseParams() as unknown,
}));

jest.mock("@/services", () => ({
  Services: { parentPortal: { fetchPortalDashboard: jest.fn() }, auth: { logout: jest.fn() } },
}));

const mockFetchDashboard = Services.parentPortal.fetchPortalDashboard as jest.MockedFunction<
  typeof Services.parentPortal.fetchPortalDashboard
>;

describe("PortalShell", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockFetchDashboard.mockReset();
    mockUseParams.mockReturnValue({ studentId: AYESHA_ID });
  });

  it("child switcher lists only summary children", async () => {
    mockFetchDashboard.mockResolvedValue(portalDashboard());
    const user = userEvent.setup();

    renderWithProviders(<PortalShell>content</PortalShell>);
    await user.click(await screen.findByRole("combobox", { name: "Child" }));

    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Ayesha Khan", "Bilal Khan"]);
  });

  it("moves to the other child's page when one is picked", async () => {
    mockFetchDashboard.mockResolvedValue(portalDashboard());
    const user = userEvent.setup();

    renderWithProviders(<PortalShell>content</PortalShell>);
    await user.click(await screen.findByRole("combobox", { name: "Child" }));
    await user.click(await screen.findByRole("option", { name: "Bilal Khan" }));

    expect(mockPush).toHaveBeenCalledWith(`/portal/${BILAL_ID}`);
  });

  it("shows no switcher for a single child", async () => {
    mockFetchDashboard.mockResolvedValue(
      portalDashboard({ children: [portalChild(AYESHA_ID, "Ayesha", "Khan")] }),
    );

    renderWithProviders(<PortalShell>content</PortalShell>);

    expect(await screen.findByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Child" })).not.toBeInTheDocument();
  });

  it("fees tab hidden when module disabled", async () => {
    mockFetchDashboard.mockResolvedValue(
      portalDashboard({ modules: { ...ALL_MODULES_ON, fees: false } }),
    );

    renderWithProviders(<PortalShell>content</PortalShell>);

    expect(await screen.findByRole("link", { name: "Attendance" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fees" })).not.toBeInTheDocument();
  });

  it("shows the fees tab, linked to the selected child, when the module is on", async () => {
    mockFetchDashboard.mockResolvedValue(portalDashboard());

    renderWithProviders(<PortalShell>content</PortalShell>);

    expect(await screen.findByRole("link", { name: "Fees" })).toHaveAttribute(
      "href",
      `/portal/${AYESHA_ID}/fees`,
    );
  });

  it("shows the unread count and the page content", async () => {
    mockFetchDashboard.mockResolvedValue(portalDashboard({ unread_notifications: 3 }));

    renderWithProviders(<PortalShell>page body</PortalShell>);

    expect(await screen.findByText("3 unread notifications")).toBeInTheDocument();
    expect(screen.getByText("page body")).toBeInTheDocument();
  });

  it("offers a retry when the summary fails to load", async () => {
    mockFetchDashboard.mockRejectedValueOnce(new Error("boom"));
    mockFetchDashboard.mockResolvedValue(portalDashboard());
    const user = userEvent.setup();

    renderWithProviders(<PortalShell>page body</PortalShell>);
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Fees" })).toBeInTheDocument();
    });
  });
});
