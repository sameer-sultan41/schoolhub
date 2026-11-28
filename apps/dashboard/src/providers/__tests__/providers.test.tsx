import { render, screen } from "@testing-library/react";
import { setUnauthorizedHandler } from "@/lib/auth";
import { AppProviders } from "../providers";

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
    handler?.(undefined as never, { impersonated: false });

    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("sends an ended impersonation to the page that says so, never to sign-in", () => {
    render(
      <AppProviders>
        <span>content</span>
      </AppProviders>,
    );

    const handler = mockSetUnauthorizedHandler.mock.calls[0]?.[0];
    handler?.(undefined as never, { impersonated: true });

    expect(mockReplace).toHaveBeenCalledWith("/impersonate?ended=1");
    expect(mockReplace).not.toHaveBeenCalledWith("/login");
  });
});
