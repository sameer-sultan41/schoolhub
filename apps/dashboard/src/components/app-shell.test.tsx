import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { AppShell } from "./app-shell";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  // UserMenu (rendered inside AppShell's header) calls useRouter() for its locale
  // switch/sign-out redirects.
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

// UserMenu imports @/lib/auth for its sign-out action, and that module calls
// createApiClient() at import time — real construction touches globalThis.fetch, which
// jsdom's test environment doesn't provide, crashing the whole suite before any test runs.
jest.mock("@/lib/auth", () => ({
  logout: jest.fn(),
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
