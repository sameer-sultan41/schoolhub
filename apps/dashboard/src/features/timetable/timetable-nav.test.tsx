import { screen } from "@testing-library/react";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import { usePermission } from "@/hooks/use-session";
import { renderWithProviders } from "@/test-utils";

const mockPathname = jest.fn(() => "/timetable");
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));
// TimetableNav never calls useSession itself — it renders <Can>, which reads
// usePermission/useAnyPermission — so those two are what get mocked.
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

describe("TimetableNav", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/timetable");
    mockUsePermission.mockReturnValue(true);
  });

  it("renders one link per surface", () => {
    renderWithProviders(<TimetableNav />);

    expect(screen.getByRole("link", { name: "Week grid" })).toHaveAttribute("href", "/timetable");
    expect(screen.getByRole("link", { name: "Periods" })).toHaveAttribute(
      "href",
      "/timetable/periods",
    );
    expect(screen.getByRole("link", { name: "Rooms" })).toHaveAttribute("href", "/timetable/rooms");
    expect(screen.getByRole("link", { name: "Substitutions" })).toHaveAttribute(
      "href",
      "/timetable/substitutions",
    );
    expect(screen.getByRole("link", { name: "My timetable" })).toHaveAttribute(
      "href",
      "/timetable/my",
    );
  });

  it("marks only the exact grid route as current on /timetable", () => {
    renderWithProviders(<TimetableNav />);

    expect(screen.getByRole("link", { name: "Week grid" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Rooms" })).not.toHaveAttribute("aria-current");
  });

  it("marks a nested route as current without also matching the grid", () => {
    mockPathname.mockReturnValue("/timetable/substitutions");
    renderWithProviders(<TimetableNav />);

    expect(screen.getByRole("link", { name: "Substitutions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Week grid" })).not.toHaveAttribute("aria-current");
  });

  it("shows a student only the surface their one permission reaches", () => {
    // Students hold `timetable.timetable.view` and nothing else — §5.7's
    // "unpublished edits never leak" rendered as navigation.
    mockUsePermission.mockImplementation((permission) => permission === "timetable.timetable.view");
    renderWithProviders(<TimetableNav />);

    expect(screen.getByRole("link", { name: "My timetable" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Week grid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Periods" })).not.toBeInTheDocument();
  });

  it("hides every link when the user holds nothing", () => {
    mockUsePermission.mockReturnValue(false);
    renderWithProviders(<TimetableNav />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
