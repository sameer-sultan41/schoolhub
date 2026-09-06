import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "@/components/command-palette";
import { useSession } from "@/hooks/use-session";
import { makeUser, renderWithProviders } from "@/test-utils";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/use-session", () => ({
  useSession: jest.fn(),
}));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;

function signedInWith(permissions: string[]) {
  mockUseSession.mockReturnValue({
    user: makeUser({ permissions: permissions as never }),
    isLoading: false,
    isAuthenticated: true,
    isUnavailable: false,
    error: null,
    refetch: jest.fn(),
  });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    mockPush.mockReset();
    signedInWith(["students.student.view", "students.student.create"]);
  });

  it("opens on Ctrl+K and closes on Escape", async () => {
    renderWithProviders(<CommandPalette />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the visible trigger too", async () => {
    // A keyboard-only feature is one most people never learn exists, which is why the
    // header carries a button rather than relying on the shortcut alone.
    renderWithProviders(<CommandPalette />);

    await userEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("lists only the modules the viewer can reach", async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.keyboard("{Control>}k{/Control}");

    expect(await screen.findByRole("option", { name: /Students/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Staff/ })).not.toBeInTheDocument();
  });

  it("never offers a module that has no route", async () => {
    // Those five are shown disabled in the sidebar so a school owner can see what the
    // platform covers. A search result that navigates to a 404 is a different, worse
    // thing than a labelled "Soon".
    renderWithProviders(<CommandPalette />);
    await userEvent.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");

    for (const planned of [/Fees/, /Admissions/, /Attendance/, /Communication/, /Website/]) {
      expect(screen.queryByRole("option", { name: planned })).not.toBeInTheDocument();
    }
  });

  it("offers an action only to a viewer who holds its permission", async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.keyboard("{Control>}k{/Control}");

    expect(await screen.findByRole("option", { name: /New student/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /New staff member/ })).not.toBeInTheDocument();
  });

  it("renders no actions group at all when the viewer holds none", async () => {
    signedInWith(["students.student.view"]);
    renderWithProviders(<CommandPalette />);
    await userEvent.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");

    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("navigates and closes when an entry is chosen", async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.click(await screen.findByRole("option", { name: /Students/ }));

    expect(mockPush).toHaveBeenCalledWith("/students");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says so when a search matches nothing", async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(await screen.findByRole("combobox"), "zzzzzz");

    expect(await screen.findByText("Nothing matches that.")).toBeInTheDocument();
  });
});
