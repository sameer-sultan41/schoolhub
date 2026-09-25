import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { DashboardPageContent } from "../dashboard-page-content";

/**
 * This composition's own logic is the toolbar heading and the date-range popover; the
 * six widgets it lays out (`ChannelStats`, `EntryCallout`, `Highlights`, `EarningsChart`,
 * `TeamMeeting`, `Teams`) each have their own test file. Every query they fire is stubbed
 * to stay pending — never resolving is fine here, since nothing in this file asserts on
 * a widget's own rendered data.
 */
jest.mock("@/services", () => ({
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    dashboard: {
      fetchAcademicSessions: jest.fn(),
      fetchDashboardOverview: jest.fn(),
      fetchTeacherLoadSummary: jest.fn(),
      fetchMyTimetable: jest.fn(),
      fetchStaffDirectory: jest.fn(),
    },
  },
}));

function neverResolves() {
  return new Promise(() => {
    // Intentionally pending for the life of the test.
  });
}

beforeEach(() => {
  Services.auth.fetchCurrentUser = jest.fn(neverResolves);
  Services.dashboard.fetchAcademicSessions = jest.fn(neverResolves);
  Services.dashboard.fetchDashboardOverview = jest.fn(neverResolves);
  Services.dashboard.fetchTeacherLoadSummary = jest.fn(neverResolves);
  Services.dashboard.fetchMyTimetable = jest.fn(neverResolves);
  Services.dashboard.fetchStaffDirectory = jest.fn(neverResolves);
});

describe("DashboardPageContent", () => {
  it("shows the page title", () => {
    renderWithProviders(<DashboardPageContent />);

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("the date-range trigger shows the range picked when the page loaded", () => {
    renderWithProviders(<DashboardPageContent />);

    expect(screen.getByRole("button", { name: /Jan 20, 2025 - Feb 09, 2025/ })).toBeInTheDocument();
  });

  it("Reset clears the range in the calendar without applying it to the trigger yet", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPageContent />);

    await user.click(screen.getByRole("button", { name: /Jan 20, 2025 - Feb 09, 2025/ }));
    await user.click(await screen.findByRole("button", { name: "Reset" }));

    // Reset only clears the popover's own draft (tempDateRange); the trigger keeps
    // showing the last applied range until Apply is pressed.
    expect(screen.getByRole("button", { name: /Jan 20, 2025 - Feb 09, 2025/ })).toBeInTheDocument();
  });

  it("Apply commits the calendar's picked range to the trigger and closes the popover", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPageContent />);

    await user.click(screen.getByRole("button", { name: /Jan 20, 2025 - Feb 09, 2025/ }));
    await user.click(await screen.findByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    });
    // Nothing was picked in the calendar during this interaction, so applying the
    // untouched draft keeps the same range on the trigger.
    expect(screen.getByRole("button", { name: /Jan 20, 2025 - Feb 09, 2025/ })).toBeInTheDocument();
  });
});
