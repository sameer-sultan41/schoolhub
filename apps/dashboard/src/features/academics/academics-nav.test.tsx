import { screen } from "@testing-library/react";
import { AcademicsNav } from "@/features/academics/academics-nav";
import { usePermission } from "@/hooks/use-session";
import { renderWithProviders } from "@/test-utils";

const mockPathname = jest.fn(() => "/academics");
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));
// AcademicsNav never calls useSession itself — it renders <Can>, which reads
// usePermission/useAnyPermission — so those two are what get mocked.
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

describe("AcademicsNav", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/academics");
    mockUsePermission.mockReturnValue(true);
  });

  it("renders one link per surface", () => {
    renderWithProviders(<AcademicsNav />);

    expect(screen.getByRole("link", { name: "Curriculum" })).toHaveAttribute("href", "/academics");
    expect(screen.getByRole("link", { name: "Teacher allocation" })).toHaveAttribute(
      "href",
      "/academics/allocations",
    );
    expect(screen.getByRole("link", { name: "Promotions" })).toHaveAttribute(
      "href",
      "/academics/promotions",
    );
  });

  it("marks only the exact curriculum route as current on /academics", () => {
    renderWithProviders(<AcademicsNav />);

    expect(screen.getByRole("link", { name: "Curriculum" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Promotions" })).not.toHaveAttribute("aria-current");
  });

  it("marks a nested promotions route as current without also matching curriculum", () => {
    mockPathname.mockReturnValue("/academics/promotions/batch-1");
    renderWithProviders(<AcademicsNav />);

    expect(screen.getByRole("link", { name: "Promotions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Curriculum" })).not.toHaveAttribute("aria-current");
  });

  it("hides every link the user has no view permission for", () => {
    mockUsePermission.mockReturnValue(false);
    renderWithProviders(<AcademicsNav />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
