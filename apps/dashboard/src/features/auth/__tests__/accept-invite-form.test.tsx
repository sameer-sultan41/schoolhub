import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { AcceptInviteForm } from "../accept-invite-form";
import { apiError, openLink } from "./link-test-support";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { auth: { previewInvitation: jest.fn(), acceptInvitation: jest.fn() } },
}));

const mockPreview = Services.auth.previewInvitation as jest.MockedFunction<
  typeof Services.auth.previewInvitation
>;
const mockAccept = Services.auth.acceptInvitation as jest.MockedFunction<
  typeof Services.auth.acceptInvitation
>;

const LINK = "/accept-invite#school=city&token=tok-secret-1";
const PREVIEW = {
  email: "parent@example.com",
  school_name: "City School",
  expires_at: "2026-11-12T10:00:00Z",
};
const GOOD_PASSWORD = "a-long-enough-pass";

async function choosePassword(password: string, confirm = password) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^new password/i), password);
  await user.type(screen.getByLabelText(/^confirm password/i), confirm);
  await user.click(screen.getByRole("button", { name: /create account/i }));
}

describe("AcceptInviteForm", () => {
  beforeEach(() => {
    mockPreview.mockReset().mockResolvedValue(PREVIEW);
    mockAccept.mockReset();
    mockReplace.mockReset();
    (toast.success as jest.Mock).mockReset();
  });

  it("reads the link from the fragment, then strips the token from the address bar", async () => {
    openLink(LINK);
    renderWithProviders(<AcceptInviteForm />);

    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalledWith({ school: "city", token: "tok-secret-1" });
    });
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("tok-secret-1");
    expect(window.location.pathname).toBe("/accept-invite");
  });

  it("shows who the invitation is for and which school sent it", async () => {
    openLink(LINK);
    renderWithProviders(<AcceptInviteForm />);

    expect(
      await screen.findByText("Choose a password for parent@example.com at City School."),
    ).toBeInTheDocument();
  });

  it("shows the invalid-link notice for a link missing its token, without calling the API", async () => {
    openLink("/accept-invite#school=city");
    renderWithProviders(<AcceptInviteForm />);

    expect(await screen.findByText("This link can't be used")).toBeInTheDocument();
    expect(screen.getByText(/ask your school to resend your invitation/i)).toBeInTheDocument();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it("explains an invalid_link preview and asks the school to resend", async () => {
    mockPreview.mockRejectedValue(apiError("invalid_link", 400));
    openLink(LINK);
    renderWithProviders(<AcceptInviteForm />);

    expect(await screen.findByText("This link can't be used")).toBeInTheDocument();
    expect(screen.getByText(/ask your school to resend your invitation/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();
  });

  it("refuses a short password and a mismatched confirmation before calling the API", async () => {
    openLink(LINK);
    renderWithProviders(<AcceptInviteForm />);

    await choosePassword("short", "short");
    expect(await screen.findByText("Use at least 10 characters.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/^new password/i));
    await user.type(screen.getByLabelText(/^new password/i), GOOD_PASSWORD);
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument();
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("accepts with the link and the password, then signs in from /login with a toast", async () => {
    mockAccept.mockResolvedValue(undefined);
    openLink(LINK);
    renderWithProviders(<AcceptInviteForm />);

    await choosePassword(GOOD_PASSWORD);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    expect(mockAccept.mock.calls[0]?.[0]).toEqual({
      school: "city",
      token: "tok-secret-1",
      password: GOOD_PASSWORD,
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Your account is ready. Sign in with your new password.",
    );
  });

  it("shows the server's weak-password reason under the password field", async () => {
    mockAccept.mockRejectedValue(
      apiError("validation_error", 400, "password", "This password is too common."),
    );
    openLink(LINK);
    renderWithProviders(<AcceptInviteForm />);

    await choosePassword(GOOD_PASSWORD);

    expect(await screen.findByText("This password is too common.")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("switches to the invalid-link notice when the accept itself is refused", async () => {
    mockAccept.mockRejectedValue(apiError("invalid_link", 400));
    openLink(LINK);
    renderWithProviders(<AcceptInviteForm />);

    await choosePassword(GOOD_PASSWORD);

    expect(await screen.findByText("This link can't be used")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
