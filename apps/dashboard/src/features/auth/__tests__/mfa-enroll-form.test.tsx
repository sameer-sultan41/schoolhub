import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { accessTokenStore } from "@/lib/auth";
import { Services } from "@/services";
import { impersonationToken } from "@/test-fixtures/impersonation";
import { buildUser, renderWithProviders } from "@/test-utils";

import { MfaEnrollForm } from "../mfa-enroll-form";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
}));

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { auth: { enrollMfa: jest.fn(), confirmMfa: jest.fn() } },
}));

const auth = Services.auth as jest.Mocked<typeof Services.auth>;

const ENROLMENT = {
  secret: "test-secret-key",
  otpauth_uri:
    "otpauth://totp/SchoolHub:ops%40schoolhub.test?secret=test-secret-key&issuer=SchoolHub",
};
const RECOVERY_CODES = ["AAAA-BBBB-CCCC-DDDD", "BBBB-CCCC-DDDD-AAAA"];
const operator = {
  ...buildUser(["platform.tenant.view"]),
  tenant_summary: null,
  is_platform: true,
  mfa_enabled: true,
};

async function startAndScan() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Set up authenticator" }));
  await screen.findByText("Scan this code");
  return user;
}

describe("MfaEnrollForm", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockRefresh.mockReset();
    auth.enrollMfa.mockReset().mockResolvedValue(ENROLMENT);
    auth.confirmMfa.mockReset();
  });

  it("starts only when asked, then shows the QR code and the secret to type", async () => {
    renderWithProviders(<MfaEnrollForm />);
    expect(auth.enrollMfa).not.toHaveBeenCalled();

    await startAndScan();

    // The SVG's <title> names the code for a screen reader.
    expect(screen.getByTitle("QR code for your authenticator app")).toBeInTheDocument();
    expect(screen.getByText("test-secret-key")).toBeInTheDocument();
  });

  it("keeps the scan step after a wrong first code", async () => {
    auth.confirmMfa.mockRejectedValue(
      new ApiError({ code: "invalid_mfa_code", message: "x", status: 400, url: "/mfa:confirm" }),
    );
    renderWithProviders(<MfaEnrollForm />);
    const user = await startAndScan();

    await user.type(screen.getByLabelText(/authentication code/i), "111111");
    await user.click(screen.getByRole("button", { name: "Turn on two-step sign-in" }));

    expect(await screen.findByText(/that code isn't right/i)).toBeInTheDocument();
    expect(screen.getByText("Scan this code")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the recovery codes once, and opens the console only after they are saved", async () => {
    auth.confirmMfa.mockResolvedValue({
      access_token: "at",
      expires_in: 900,
      user: operator,
      recovery_codes: RECOVERY_CODES,
    });
    renderWithProviders(<MfaEnrollForm />);
    const user = await startAndScan();

    await user.type(screen.getByLabelText(/authentication code/i), "123456");
    await user.click(screen.getByRole("button", { name: "Turn on two-step sign-in" }));

    expect(await screen.findByText("AAAA-BBBB-CCCC-DDDD")).toBeInTheDocument();
    expect(screen.getByText("BBBB-CCCC-DDDD-AAAA")).toBeInTheDocument();
    const proceed = screen.getByRole("button", { name: "Continue to the console" });
    expect(proceed).toBeDisabled();

    await user.click(screen.getByLabelText(/saved these codes/i));
    await user.click(proceed);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/platform");
    });
    expect(auth.confirmMfa.mock.calls[0]?.[0]).toBe("123456");
  });

  it("offers a new sign-in when the session has ended", async () => {
    auth.enrollMfa.mockRejectedValue(
      new ApiError({ code: "unauthenticated", message: "x", status: 401, url: "/auth/mfa:enroll" }),
    );
    renderWithProviders(<MfaEnrollForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Set up authenticator" }));

    expect(await screen.findByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("under impersonation shows why instead of starting an enrolment", () => {
    accessTokenStore.set(impersonationToken(), 1800);
    try {
      renderWithProviders(<MfaEnrollForm />);

      expect(screen.getByText("Not available in a support session")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Set up authenticator" }),
      ).not.toBeInTheDocument();
      expect(auth.enrollMfa).not.toHaveBeenCalled();
    } finally {
      accessTokenStore.clear();
    }
  });
});
