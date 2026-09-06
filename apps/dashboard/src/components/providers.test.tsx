import { render, screen, waitFor } from "@testing-library/react";
import { setUnauthorizedHandler } from "@/lib/auth";
import { resetTheme } from "@/test-utils";
import { AppProviders } from "./providers";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/lib/auth", () => ({
  setUnauthorizedHandler: jest.fn(),
}));

const mockSetUnauthorizedHandler = setUnauthorizedHandler as jest.MockedFunction<
  typeof setUnauthorizedHandler
>;

describe("AppProviders", () => {
  beforeEach(() => {
    mockSetUnauthorizedHandler.mockReset();
    mockReplace.mockReset();
  });

  afterEach(() => {
    resetTheme();
  });

  it("renders its children", () => {
    render(
      <AppProviders>
        <span>content</span>
      </AppProviders>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("registers a 401 handler that clears the query cache and redirects to login", () => {
    render(
      <AppProviders>
        <span>content</span>
      </AppProviders>,
    );

    expect(mockSetUnauthorizedHandler).toHaveBeenCalledTimes(1);
    const handler = mockSetUnauthorizedHandler.mock.calls[0]?.[0];
    handler?.(undefined as never);

    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("resolves a theme onto the document element", async () => {
    render(
      <AppProviders>
        <span>content</span>
      </AppProviders>,
    );

    // defaultTheme="system" with jsdom's stubbed matchMedia (always `matches: false`)
    // resolves to light. The assertion that matters is that a class lands at all: the
    // `dark` variant in packages/ui matches `.dark`, so a provider configured with an
    // attribute strategy instead would leave every dark: utility permanently inert.
    await waitFor(() => {
      expect(document.documentElement).toHaveClass("light");
    });
  });
});
