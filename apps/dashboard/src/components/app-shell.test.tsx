import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiResult, makeUser, renderWithProviders } from "@/test-utils";
import { useSession } from "@/hooks/use-session";
import { apiClient, logout } from "@/lib/auth";
import { AppShell } from "./app-shell";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
}));

jest.mock("@/hooks/use-session", () => ({
  useSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn() },
  logout: jest.fn(),
}));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockLogout = logout as jest.MockedFunction<typeof logout>;

/** The sign-out control now lives behind the account menu, exactly as a user reaches it. */
async function openAccountMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Account" }));
}

describe("AppShell", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockGet.mockReset().mockResolvedValue(apiResult(null));
    mockLogout.mockReset().mockResolvedValue(undefined);
    mockUseSession.mockReset().mockReturnValue({
      user: makeUser({ permissions: ["students.student.view"] }),
      isLoading: false,
      isAuthenticated: true,
      isUnavailable: false,
      error: null,
      refetch: jest.fn(),
    });
  });

  it("shows only the modules the user has permission for, plus dashboard", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Students" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fees & Finance" })).not.toBeInTheDocument();
  });

  it("hides a built module the user holds no permission for", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    // `staff` is a real module with a real screen — no permission means no entry at all,
    // not a disabled one.
    expect(screen.queryByRole("link", { name: "Staff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Staff" })).not.toBeInTheDocument();
  });

  it("marks the current route's nav link as active", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("groups the navigation under labelled sections", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    for (const label of ["Overview", "People", "Teaching", "Operations"]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it("keeps exactly one primary navigation landmark", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    // One <nav> wrapping all four groups, not one per group: e2e scopes every navigation
    // assertion to this single landmark.
    expect(screen.getAllByRole("navigation", { name: "Primary navigation" })).toHaveLength(1);
  });

  it("renders an unbuilt module as a disabled control rather than a link", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    const fees = screen.getByRole("button", { name: "Fees & Finance" });
    expect(fees).toHaveAttribute("aria-disabled", "true");
    expect(fees.tagName).toBe("BUTTON");
    // A link here would navigate to a route that does not exist, and e2e's navLink()
    // would happily find and click it.
    expect(screen.queryByRole("link", { name: "Fees & Finance" })).not.toBeInTheDocument();
  });

  it("says when a module is coming rather than leaving it inert without explanation", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    const fees = screen.getByRole("button", { name: "Fees & Finance" });
    expect(fees).toHaveAccessibleDescription("Soon");
    expect(fees).toHaveAttribute("title", "Fees & Finance is not built yet.");
  });

  it("shows every planned module regardless of permissions", () => {
    // No permission key exists for a module the API has not built, so gating these on one
    // would hide the whole roadmap from everyone, forever.
    mockUseSession.mockReturnValue({
      user: makeUser({ permissions: [] }),
      isLoading: false,
      isAuthenticated: true,
      isUnavailable: false,
      error: null,
      refetch: jest.fn(),
    });

    renderWithProviders(<AppShell>content</AppShell>);

    for (const label of [
      "Attendance",
      "Fees & Finance",
      "Admissions",
      "Communication",
      "Website",
    ]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.queryByRole("link", { name: "Students" })).not.toBeInTheDocument();
  });

  it("keeps nav icons out of every entry's accessible name", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    // e2e matches nav entries by their exact accessible name; an icon that contributes so
    // much as a word to it breaks every navigation spec at once.
    const students = screen.getByRole("link", { name: "Students" });
    expect(students).toHaveAccessibleName("Students");
    expect(students.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to the platform name before the tenant loads", () => {
    renderWithProviders(<AppShell>content</AppShell>);
    expect(screen.getByText("SchoolHub")).toBeInTheDocument();
  });

  it("uses the tenant's own name once it loads", async () => {
    mockGet.mockResolvedValue(apiResult({ id: "t1", name: "City School", branding: null }));

    renderWithProviders(<AppShell>content</AppShell>);

    await waitFor(() => {
      expect(screen.getByText("City School")).toBeInTheDocument();
    });
  });

  it("shows the impersonation banner only when impersonated", () => {
    mockUseSession.mockReturnValue({
      user: makeUser({ impersonated_by: "support-1" }),
      isLoading: false,
      isAuthenticated: true,
      isUnavailable: false,
      error: null,
      refetch: jest.fn(),
    });

    renderWithProviders(<AppShell>content</AppShell>);

    expect(
      screen.getByText("You are viewing this account as support staff. Every action is audited."),
    ).toBeInTheDocument();
  });

  it("names the impersonation banner so it can be told apart from any other status", () => {
    mockUseSession.mockReturnValue({
      user: makeUser({ impersonated_by: "support-1" }),
      isLoading: false,
      isAuthenticated: true,
      isUnavailable: false,
      error: null,
      refetch: jest.fn(),
    });

    renderWithProviders(<AppShell>content</AppShell>);

    // The name is its own short key, not the sentence the banner contains: naming a live
    // region after its own content makes a screen reader announce it twice.
    expect(screen.getByRole("status", { name: "Impersonation notice" })).toBeInTheDocument();
  });

  it("does not show the impersonation banner for a normal session", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    expect(
      screen.queryByText(/You are viewing this account as support staff/),
    ).not.toBeInTheDocument();
  });

  it("renders the children in the main content area", () => {
    renderWithProviders(<AppShell>page content</AppShell>);
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("puts the theme and account controls in the header", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    expect(screen.getByRole("button", { name: "Change theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    // The bare name and the always-visible destructive button are gone; both live behind
    // the account menu now.
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("signs out and redirects to /login on click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>);

    await openAccountMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("still redirects to /login even when the sign-out request fails", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockLogout.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();

    renderWithProviders(<AppShell>content</AppShell>);
    await openAccountMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    consoleError.mockRestore();
  });
});
