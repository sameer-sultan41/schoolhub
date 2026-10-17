import { screen } from "@testing-library/react";
import { usePathname } from "next/navigation";

import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { SidebarMenu } from "../sidebar-menu";

jest.mock("next/navigation", () => ({ usePathname: jest.fn() }));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

describe("SidebarMenu — Academics group", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/academics/curriculum");
  });

  it("shows the Curriculum child to a user who holds its view key", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["academics.curriculum.view"]));

    renderWithProviders(<SidebarMenu />);

    const link = await screen.findByRole("link", { name: "Curriculum" });
    expect(link).toHaveAttribute("href", "/academics/curriculum");
    expect(screen.getByText("Academics")).toBeInTheDocument();
  });

  it("shows the Promotions child to a user who holds only its view key", async () => {
    mockUsePathname.mockReturnValue("/academics/promotions");
    mockFetchCurrentUser.mockResolvedValue(buildUser(["academics.promotion.view"]));

    renderWithProviders(<SidebarMenu />);

    const link = await screen.findByRole("link", { name: "Promotions" });
    expect(link).toHaveAttribute("href", "/academics/promotions");
    expect(screen.queryByRole("link", { name: "Curriculum" })).not.toBeInTheDocument();
  });

  it("hides the whole group from a user who holds no academics child key", async () => {
    mockUsePathname.mockReturnValue("/staff");
    // "staff.staff.view" makes the Staff link appear, which is how the test knows the user loaded.
    // The create keys are not a section's `.view` key, so neither opens a child.
    mockFetchCurrentUser.mockResolvedValue(
      buildUser(["staff.staff.view", "academics.promotion.create", "academics.curriculum.create"]),
    );

    renderWithProviders(<SidebarMenu />);

    expect(await screen.findByRole("link", { name: "Staff" })).toBeInTheDocument();
    expect(screen.queryByText("Academics")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Curriculum" })).not.toBeInTheDocument();
  });
});
