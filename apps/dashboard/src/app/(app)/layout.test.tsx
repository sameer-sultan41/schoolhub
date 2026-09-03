import { render, screen } from "@testing-library/react";
import AppLayout from "./layout";

jest.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

describe("AppLayout", () => {
  it("renders its children inside AppShell", () => {
    render(
      <AppLayout>
        <span>page content</span>
      </AppLayout>,
    );

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
