import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { MfaVerifyForm } from "../mfa-verify-form";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();
const mockGet = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
  useSearchParams: () => ({ get: mockGet }),
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: {
      verifyMfa: jest.fn(),
      hasPendingMfaChallenge: jest.fn(),
      subscribeMfaChallenge: jest.fn(() => () => undefined),
    },
  },
}));

const auth = Services.auth as jest.Mocked<typeof Services.auth>;

/** `core/rbac/views.py`'s refusals: a 400 with a code and no field details, or a 429. */
function refusal(status: number, code: string, retryAfter: number | null = null) {
  return new ApiError({ code, message: code, status, url: "/mfa:verify", retryAfter });
}

const operator = {
  ...buildUser(["platform.tenant.view"]),
  tenant_summary: null,
  is_platform: true,
  mfa_enabled: true,
};

async function submitCode(code: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/authentication code/i), code);
  await user.click(screen.getByRole("button", { name: "Verify" }));
  return user;
}

describe("MfaVerifyForm", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockGet.mockReset().mockReturnValue(null);
    auth.verifyMfa.mockReset();
    auth.hasPendingMfaChallenge.mockReset().mockReturnValue(true);
  });

  it("asks for a new sign-in when there is no challenge in this tab", () => {
    auth.hasPendingMfaChallenge.mockReturnValue(false);

    renderWithProviders(<MfaVerifyForm />);

    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText(/authentication code/i)).not.toBeInTheDocument();
  });

  it("refuses a code that isn't six digits before asking the server", async () => {
    renderWithProviders(<MfaVerifyForm />);

    await submitCode("12ab");

    expect(await screen.findByText("Enter the six digits your app shows.")).toBeInTheDocument();
    expect(auth.verifyMfa).not.toHaveBeenCalled();
  });

  it("stays on the page after a wrong code, never sending the user to sign in", async () => {
    auth.verifyMfa.mockRejectedValue(refusal(400, "invalid_mfa_code"));
    renderWithProviders(<MfaVerifyForm />);

    await submitCode("000000");

    expect(await screen.findByText(/that code isn't right/i)).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
  });

  it("says how long a lock lasts, from Retry-After", async () => {
    auth.verifyMfa.mockRejectedValue(refusal(429, "mfa_locked", 900));
    renderWithProviders(<MfaVerifyForm />);

    await submitCode("123456");

    expect(await screen.findByText(/try again in 15 minutes/i)).toBeInTheDocument();
  });

  it("sends a lock with no Retry-After to an administrator", async () => {
    auth.verifyMfa.mockRejectedValue(refusal(429, "mfa_locked"));
    renderWithProviders(<MfaVerifyForm />);

    await submitCode("123456");

    expect(await screen.findByText(/ask a platform administrator/i)).toBeInTheDocument();
  });

  it("signs the operator in and lands them on the console", async () => {
    auth.verifyMfa.mockResolvedValue({ access_token: "at", expires_in: 900, user: operator });
    renderWithProviders(<MfaVerifyForm />);

    await submitCode("123456");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/platform");
    });
    expect(auth.verifyMfa.mock.calls[0]?.[0]).toEqual({ code: "123456" });
  });

  it("never sends the operator to a next a browser reads as another host", async () => {
    mockGet.mockReturnValue("/\\evil.example");
    auth.verifyMfa.mockResolvedValue({ access_token: "at", expires_in: 900, user: operator });
    renderWithProviders(<MfaVerifyForm />);

    await submitCode("123456");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/platform");
    });
  });

  it("honours a same-origin next, and takes a recovery code instead", async () => {
    mockGet.mockReturnValue("/platform/plans");
    auth.verifyMfa.mockResolvedValue({ access_token: "at", expires_in: 900, user: operator });
    renderWithProviders(<MfaVerifyForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /use a recovery code/i }));
    await user.type(await screen.findByLabelText(/recovery code/i), "aaaa-bbbb-cccc-dddd");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/platform/plans");
    });
    expect(auth.verifyMfa.mock.calls[0]?.[0]).toEqual({ recovery_code: "aaaa-bbbb-cccc-dddd" });
  });
});
