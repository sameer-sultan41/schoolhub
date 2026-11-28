import { screen, waitFor } from "@testing-library/react";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { ImpersonationHandoff } from "../impersonation-handoff";
import { apiError, openLink } from "./link-test-support";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => Record<string, unknown> }>(
    "@/test-utils",
  );
  return { ...testUtils.createNavigationMock(), useRouter: () => ({ replace: mockReplace }) };
});
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { auth: { exchangeImpersonationCode: jest.fn() } },
}));

const mockExchange = Services.auth.exchangeImpersonationCode as jest.MockedFunction<
  typeof Services.auth.exchangeImpersonationCode
>;

const LINK = "/impersonate#school=city-school&code=handoff-secret-1";

describe("ImpersonationHandoff", () => {
  beforeEach(() => {
    mockExchange.mockReset().mockResolvedValue(undefined);
    mockReplace.mockReset();
  });

  it("reads the code from the fragment once, clears it, exchanges it and opens the dashboard", async () => {
    openLink(LINK);
    renderWithProviders(<ImpersonationHandoff />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
    expect(mockExchange).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledWith("handoff-secret-1");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("handoff-secret-1");
    expect(window.location.pathname).toBe("/impersonate");
  });

  it("a spent or expired code says to start again from the console", async () => {
    openLink(LINK);
    mockExchange.mockRejectedValueOnce(apiError("invalid_link", 400));
    renderWithProviders(<ImpersonationHandoff />);

    expect(await screen.findByText("This support link can't be used")).toBeInTheDocument();
    expect(screen.getByText(/start a new session from the platform console/i)).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("a link without a code never reaches the API", async () => {
    openLink("/impersonate#school=city-school");
    renderWithProviders(<ImpersonationHandoff />);

    expect(await screen.findByText("This support link can't be used")).toBeInTheDocument();
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("an ended session explains why the tab stopped, reload included", async () => {
    openLink("/impersonate?ended=1");
    renderWithProviders(<ImpersonationHandoff />);

    expect(await screen.findByText("This support session has ended")).toBeInTheDocument();
    expect(screen.getByText(/reloading this tab also ends it/i)).toBeInTheDocument();
    expect(mockExchange).not.toHaveBeenCalled();
  });
});
