import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiResult, makeUser, renderWithProviders } from "@/test-utils";
import { useSession } from "@/hooks/use-session";
import { apiClient, logout } from "@/lib/auth";
import { AppShell } from "./app-shell";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: mockReplace }),
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

describe("AppShell", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockGet.mockReset().mockResolvedValue(apiResult(null));
    mockLogout.mockReset().mockResolvedValue(undefined);
    mockUseSession.mockReset().mockReturnValue({
      user: makeUser({ permissions: ["students.student.view"] }),
      isLoading: false,
      isAuthenticated: true,
      refetch: jest.fn(),
    });
  });

  it("shows only the modules the user has permission for, plus dashboard", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Students" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fees & Finance" })).not.toBeInTheDocument();
  });

  it("marks the current route's nav link as active", () => {
    renderWithProviders(<AppShell>content</AppShell>);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
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
      refetch: jest.fn(),
    });

    renderWithProviders(<AppShell>content</AppShell>);

    expect(
      screen.getByText("You are viewing this account as support staff. Every action is audited."),
    ).toBeInTheDocument();
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

  it("signs out and redirects to /login on click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

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
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    consoleError.mockRestore();
  });
});
