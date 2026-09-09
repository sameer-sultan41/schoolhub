import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { AppShell } from "./app-shell";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("AppShell", () => {
  it("renders its children inside the shell", () => {
    renderWithProviders(<AppShell>page content</AppShell>);
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("renders exactly one primary navigation landmark with the full nav", () => {
    renderWithProviders(<AppShell>content</AppShell>);
    expect(screen.getAllByRole("navigation", { name: "Primary navigation" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Students" })).toBeInTheDocument();
  });

  it("renders the sidebar collapse toggle and trigger", () => {
    renderWithProviders(<AppShell>content</AppShell>);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Primary navigation" })).toBeInTheDocument();
  });
});
