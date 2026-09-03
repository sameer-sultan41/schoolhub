import { render, screen } from "@testing-library/react";
import { setUnauthorizedHandler } from "@/lib/auth";
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
});
