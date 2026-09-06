import type { Role } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeUser, renderWithProviders } from "@/test-utils";
import { logout } from "@/lib/auth";
import { UserMenu } from "./user-menu";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
}));

jest.mock("@/lib/auth", () => ({
  logout: jest.fn(),
}));

const mockLogout = logout as jest.MockedFunction<typeof logout>;

const SCHOOL_ADMIN: Role = {
  id: "role-1",
  slug: "school-admin",
  name: "School Admin",
  is_custom: false,
  scope: "all",
};

/** Opens the menu the way a user does — nothing inside it exists until then. */
async function openMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Account" }));
}

describe("UserMenu", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockLogout.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    // jsdom keeps document.cookie across tests in a file, and clearMocks does not touch it.
    document.cookie = "sh_locale=; path=/; max-age=0";
  });

  it("names the trigger rather than leaving a screen reader with two letters", () => {
    renderWithProviders(<UserMenu user={makeUser()} />);

    const trigger = screen.getByRole("button", { name: "Account" });
    expect(trigger).toHaveAccessibleName("Account");
  });

  it("falls back to the user's initials", () => {
    renderWithProviders(<UserMenu user={makeUser({ full_name: "Ayesha Khan" })} />);

    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("uses a single initial for a single-word name", () => {
    renderWithProviders(<UserMenu user={makeUser({ full_name: "Ayesha" })} />);

    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders without a user rather than crashing before the session resolves", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={null} />);

    await openMenu(user);

    // No name and no role to show, but sign-out is exactly what a stuck session needs.
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the name and the first role slug", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <UserMenu user={makeUser({ full_name: "Ayesha Khan", roles: [SCHOOL_ADMIN] })} />,
    );

    await openMenu(user);

    expect(screen.getByText("Ayesha Khan")).toBeInTheDocument();
    expect(screen.getByText("school-admin")).toBeInTheDocument();
  });

  it("omits the role line for a user who holds none", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={makeUser({ roles: [] })} />);

    await openMenu(user);

    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.queryByText("school-admin")).not.toBeInTheDocument();
  });

  it("offers both shipped locales and marks the active one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={makeUser()} />);

    await openMenu(user);

    expect(screen.getByRole("menuitemradio", { name: "English" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "اردو" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("writes the locale cookie the server reads, then re-renders the route", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={makeUser()} />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "اردو" }));

    // The locale (and <html dir>) is resolved server-side from this cookie, so a client
    // state change alone would leave the page in English.
    expect(document.cookie).toContain("sh_locale=ur");
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("does nothing when the already-active locale is picked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={makeUser()} />);

    await openMenu(user);
    // Radix fires onValueChange even for the checked item; a server round-trip for a
    // no-op change is pure churn.
    await user.click(screen.getByRole("menuitemradio", { name: "English" }));

    expect(document.cookie).not.toContain("sh_locale");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("signs out and sends the user to /login", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu user={makeUser()} />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("still reaches /login when the sign-out request fails unexpectedly", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockLogout.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();

    renderWithProviders(<UserMenu user={makeUser()} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    // Logged, not swallowed: a failure here is worth seeing even though the user still
    // gets out.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
