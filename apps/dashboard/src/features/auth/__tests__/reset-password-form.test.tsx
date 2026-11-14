import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { ResetPasswordForm } from "../reset-password-form";
import { apiError, openLink } from "./link-test-support";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { auth: { confirmPasswordReset: jest.fn() } },
}));

const mockConfirm = Services.auth.confirmPasswordReset as jest.MockedFunction<
  typeof Services.auth.confirmPasswordReset
>;

const LINK = "/reset-password#school=city&uid=dWlkLTE&token=reset-secret-1";
const GOOD_PASSWORD = "a-long-enough-pass";

async function choosePassword(password: string, confirm = password) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^new password/i), password);
  await user.type(screen.getByLabelText(/^confirm password/i), confirm);
  await user.click(screen.getByRole("button", { name: /save password/i }));
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    mockConfirm.mockReset();
    mockReplace.mockReset();
    (toast.success as jest.Mock).mockReset();
  });

  it("strips the token from the address bar once it has read the link", async () => {
    openLink(LINK);
    renderWithProviders(<ResetPasswordForm />);

    expect(await screen.findByLabelText(/^new password/i)).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("reset-secret-1");
  });

  it("shows the invalid-link notice, with a way to ask for a new link, when a value is missing", async () => {
    openLink("/reset-password#school=city&token=reset-secret-1");
    renderWithProviders(<ResetPasswordForm />);

    expect(await screen.findByText("This link can't be used")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("refuses mismatched passwords before calling the API", async () => {
    openLink(LINK);
    renderWithProviders(<ResetPasswordForm />);

    await choosePassword(GOOD_PASSWORD, `${GOOD_PASSWORD}-typo`);

    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("sends the link and the new password, then goes to /login with a toast", async () => {
    mockConfirm.mockResolvedValue(undefined);
    openLink(LINK);
    renderWithProviders(<ResetPasswordForm />);

    await choosePassword(GOOD_PASSWORD);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    expect(mockConfirm.mock.calls[0]?.[0]).toEqual({
      school: "city",
      uid: "dWlkLTE",
      token: "reset-secret-1",
      new_password: GOOD_PASSWORD,
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Your password has been changed. Sign in with the new one.",
    );
  });

  it("shows the server's new_password reason under the password field", async () => {
    mockConfirm.mockRejectedValue(
      apiError("validation_error", 400, "new_password", "This password is entirely numeric."),
    );
    openLink(LINK);
    renderWithProviders(<ResetPasswordForm />);

    await choosePassword(GOOD_PASSWORD);

    expect(await screen.findByText("This password is entirely numeric.")).toBeInTheDocument();
  });

  it("switches to the invalid-link notice on invalid_link", async () => {
    mockConfirm.mockRejectedValue(apiError("invalid_link", 400));
    openLink(LINK);
    renderWithProviders(<ResetPasswordForm />);

    await choosePassword(GOOD_PASSWORD);

    expect(await screen.findByText("This link can't be used")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
