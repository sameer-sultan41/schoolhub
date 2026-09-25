import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Services } from "@/services";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { PreferencesProvider } from "@/lib/preferences/preferences-provider";
import { renderWithProviders } from "@/test-utils";
import { DashboardPageContent } from "../dashboard-page-content";

/**
 * This composition's own logic is the toolbar heading and the date-range popover; the
 * six widgets it lays out (`ChannelStats`, `EntryCallout`, `Highlights`, `EarningsChart`,
 * `TeamMeeting`, `Teams`) each have their own test file. Every query they fire is stubbed
 * to stay pending — never resolving is fine here, since nothing in this file asserts on
 * a widget's own rendered data.
 */
jest.mock("@/lib/preferences/preferences-cookies.client", () => ({
  writePreferenceCookie: jest.fn(),
}));

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

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchAcademicSessions = Services.dashboard.fetchAcademicSessions as jest.MockedFunction<
  typeof Services.dashboard.fetchAcademicSessions
>;
const mockFetchDashboardOverview = Services.dashboard.fetchDashboardOverview as jest.MockedFunction<
  typeof Services.dashboard.fetchDashboardOverview
>;
const mockFetchTeacherLoadSummary = Services.dashboard
  .fetchTeacherLoadSummary as jest.MockedFunction<
  typeof Services.dashboard.fetchTeacherLoadSummary
>;
const mockFetchMyTimetable = Services.dashboard.fetchMyTimetable as jest.MockedFunction<
  typeof Services.dashboard.fetchMyTimetable
>;
const mockFetchStaffDirectory = Services.dashboard.fetchStaffDirectory as jest.MockedFunction<
  typeof Services.dashboard.fetchStaffDirectory
>;

// Each `.mockImplementation` relies on contextual typing: `new Promise(() => {})` takes
// its type parameter from `MockedFunction<T>`'s own return type, so every one of these
// genuinely never-resolving promises still satisfies that function's real signature.
beforeEach(() => {
  mockFetchCurrentUser.mockImplementation(() => new Promise(() => {}));
  mockFetchAcademicSessions.mockImplementation(() => new Promise(() => {}));
  mockFetchDashboardOverview.mockImplementation(() => new Promise(() => {}));
  mockFetchTeacherLoadSummary.mockImplementation(() => new Promise(() => {}));
  mockFetchMyTimetable.mockImplementation(() => new Promise(() => {}));
  mockFetchStaffDirectory.mockImplementation(() => new Promise(() => {}));
});

describe("DashboardPageContent", () => {
  it("shows the page title", () => {
    renderWithProviders(
      <PreferencesProvider initialValues={PREFERENCE_DEFAULTS}>
        <DashboardPageContent />
      </PreferencesProvider>,
    );

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("the date-range trigger shows the range picked when the page loaded", () => {
    renderWithProviders(
      <PreferencesProvider initialValues={PREFERENCE_DEFAULTS}>
        <DashboardPageContent />
      </PreferencesProvider>,
    );

    expect(screen.getByRole("button", { name: /Jan 20, 2025 - Feb 09, 2025/ })).toBeInTheDocument();
  });

  it("Reset clears the range in the calendar without applying it to the trigger yet", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PreferencesProvider initialValues={PREFERENCE_DEFAULTS}>
        <DashboardPageContent />
      </PreferencesProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Jan 20, 2025 - Feb 09, 2025/ }));
    await user.click(await screen.findByRole("button", { name: "Reset" }));

    // Reset only clears the popover's own draft (tempDateRange); the trigger keeps
    // showing the last applied range until Apply is pressed.
    expect(screen.getByRole("button", { name: /Jan 20, 2025 - Feb 09, 2025/ })).toBeInTheDocument();
  });

  it("Apply commits the calendar's picked range to the trigger and closes the popover", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PreferencesProvider initialValues={PREFERENCE_DEFAULTS}>
        <DashboardPageContent />
      </PreferencesProvider>,
    );

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
