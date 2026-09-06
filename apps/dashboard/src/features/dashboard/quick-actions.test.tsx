import type { PermissionKey } from "@schoolhub/types";
import { screen } from "@testing-library/react";
import { usePermission, useSession } from "@/hooks/use-session";
import { makeUser, renderWithProviders } from "@/test-utils";
import { QuickActions } from "./quick-actions";

// All three, not just `useSession`: `<Can>` reads `usePermission`/`useAnyPermission`
// from this same module, and a factory naming only `useSession` replaces the other two
// with undefined — which fails inside `Can`, not here, and reads as a product bug.
jest.mock("@/hooks/use-session", () => ({
  useSession: jest.fn(),
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const EVERY_KEY: PermissionKey[] = [
  "students.student.create",
  "staff.staff.create",
  "students.student.import",
  "timetable.slot.create",
  "academics.promotion.view",
];

function signIn(permissions: PermissionKey[]) {
  mockUseSession.mockReturnValue({
    user: makeUser({ permissions }),
    isLoading: false,
    isAuthenticated: true,
    isUnavailable: false,
    error: null,
    refetch: jest.fn(),
  });
  // Driven off the same list, so the gate and the card can never disagree: a test that
  // grants nothing renders nothing.
  mockUsePermission.mockImplementation((permission) => permissions.includes(permission));
}

describe("QuickActions", () => {
  beforeEach(() => {
    signIn(EVERY_KEY);
  });

  it("renders every action a fully permissioned admin can start", () => {
    renderWithProviders(<QuickActions />);

    expect(screen.getByRole("link", { name: "New student" })).toHaveAttribute(
      "href",
      "/students/new",
    );
    expect(screen.getByRole("link", { name: "New staff member" })).toHaveAttribute(
      "href",
      "/staff/new",
    );
    expect(screen.getByRole("link", { name: "Import students" })).toHaveAttribute(
      "href",
      "/students/import",
    );
    expect(screen.getByRole("link", { name: "Build timetable" })).toHaveAttribute(
      "href",
      "/timetable",
    );
    expect(screen.getByRole("link", { name: "Review promotions" })).toHaveAttribute(
      "href",
      "/academics/promotions",
    );
  });

  it("appends no arrow glyph to any label", () => {
    renderWithProviders(<QuickActions />);

    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent).not.toContain("→");
    }
  });

  it("shows only the actions the viewer's keys allow", () => {
    signIn(["students.student.create"]);
    renderWithProviders(<QuickActions />);

    expect(screen.getByRole("link", { name: "New student" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import students" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Build timetable" })).not.toBeInTheDocument();
  });

  it("renders nothing at all — not an empty card — when the viewer can start none of them", () => {
    signIn(["students.student.view"]);
    const { container } = renderWithProviders(<QuickActions />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Quick actions")).not.toBeInTheDocument();
  });
});
