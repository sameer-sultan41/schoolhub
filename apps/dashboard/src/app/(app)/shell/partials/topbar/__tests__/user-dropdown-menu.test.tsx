import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../../../../../../messages/en.json";
import { Services } from "@/services";
import { UserDropdownMenu } from "../user-dropdown-menu";

// Module-scoped, not created inside the mock factories below: `useRouter`/`useTheme` are
// called fresh on every render, and a factory that returns `{ replace: jest.fn() }`
// inline would hand a NEW mock to each render — a test asserting "called with X" would be
// asserting on whichever jest.fn() happened to back the render that handled the click,
// not one it can reliably hold a reference to.
const mockRouterReplace = jest.fn();
const mockRouterRefresh = jest.fn();
const mockSetTheme = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace, refresh: mockRouterRefresh }),
}));

jest.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: mockSetTheme }),
}));

jest.mock("@/lib/auth", () => ({ logout: jest.fn() }));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn(), logout: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockLogout = Services.auth.logout as jest.MockedFunction<typeof Services.auth.logout>;

function renderMenu(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("user-menu-trigger"));
}

describe("UserDropdownMenu", () => {
  beforeEach(() => {
    mockFetchCurrentUser.mockReset();
    mockLogout.mockReset();
    mockRouterReplace.mockReset();
    mockRouterRefresh.mockReset();
    mockSetTheme.mockReset();
  });

  function baseUser() {
    return {
      id: "u1",
      email: "school_admin@demo.localhost",
      phone: null,
      full_name: "School Admin Demo",
      avatar_url: null,
      locale: "en",
      tenant_id: "t1",
      roles: [],
      permissions: [],
    };
  }

  it("shows the real signed-in user's name, contact and role, not a hardcoded sample profile", async () => {
    mockFetchCurrentUser.mockResolvedValue({
      id: "u1",
      email: "school_admin@demo.localhost",
      phone: null,
      full_name: "School Admin Demo",
      avatar_url: null,
      locale: "en",
      tenant_id: "t1",
      roles: [{ id: "r1", slug: "school_admin", name: "School Admin", is_custom: false }],
      permissions: [],
    });

    renderMenu(<UserDropdownMenu />);
    await openMenu();

    expect(await screen.findByText("School Admin Demo")).toBeInTheDocument();
    expect(screen.getByText("school_admin@demo.localhost")).toBeInTheDocument();
    expect(screen.getByText("School Admin")).toBeInTheDocument();
    expect(screen.queryByText("Jenny Klabber")).not.toBeInTheDocument();
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
  });

  it("shows initials instead of a stock photo when no avatar is on file", async () => {
    mockFetchCurrentUser.mockResolvedValue({
      id: "u2",
      email: "teacher@demo.localhost",
      phone: null,
      full_name: "Sara Malik",
      avatar_url: null,
      locale: "en",
      tenant_id: "t1",
      roles: [],
      permissions: [],
    });

    renderMenu(<UserDropdownMenu />);
    await openMenu();

    await screen.findByText("Sara Malik");
    expect(screen.getAllByText("SM").length).toBeGreaterThan(0);
  });

  it("falls back to phone when the account has no email", async () => {
    mockFetchCurrentUser.mockResolvedValue({
      id: "u3",
      email: null,
      phone: "+15550001234",
      full_name: "Bilal Ahmed",
      avatar_url: null,
      locale: "en",
      tenant_id: "t1",
      roles: [],
      permissions: [],
    });

    renderMenu(<UserDropdownMenu />);
    await openMenu();

    expect(await screen.findByText("+15550001234")).toBeInTheDocument();
  });

  it("does not render a role badge for an account with no roles", async () => {
    mockFetchCurrentUser.mockResolvedValue({
      id: "u4",
      email: "nobody@demo.localhost",
      phone: null,
      full_name: "No Role",
      avatar_url: null,
      locale: "en",
      tenant_id: "t1",
      roles: [],
      permissions: [],
    });

    renderMenu(<UserDropdownMenu />);
    await openMenu();

    await screen.findByText("No Role");
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
  });

  describe("Logout", () => {
    it("signs out and always lands on /login, even on a genuine failure", async () => {
      mockFetchCurrentUser.mockResolvedValue(baseUser());
      mockLogout.mockResolvedValue(undefined);
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      const user = userEvent.setup();

      renderMenu(<UserDropdownMenu />);
      await openMenu();
      await user.click(await screen.findByRole("button", { name: "Logout" }));

      expect(mockLogout).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(mockRouterReplace).toHaveBeenCalledWith("/login");
      });
      expect(consoleError).not.toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it("still reaches /login when the sign-out request itself fails, and logs it", async () => {
      mockFetchCurrentUser.mockResolvedValue(baseUser());
      const failure = new Error("network down");
      mockLogout.mockRejectedValue(failure);
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      const user = userEvent.setup();

      renderMenu(<UserDropdownMenu />);
      await openMenu();
      await user.click(await screen.findByRole("button", { name: "Logout" }));

      await waitFor(() => {
        expect(mockRouterReplace).toHaveBeenCalledWith("/login");
      });
      expect(consoleError).toHaveBeenCalledWith("Sign-out request failed unexpectedly:", failure);

      consoleError.mockRestore();
    });
  });

  describe("Dark Mode", () => {
    it("switching it on calls setTheme('dark')", async () => {
      mockFetchCurrentUser.mockResolvedValue(baseUser());
      const user = userEvent.setup();

      renderMenu(<UserDropdownMenu />);
      await openMenu();
      await user.click(await screen.findByRole("switch"));

      expect(mockSetTheme).toHaveBeenCalledWith("dark");
    });
  });
});
