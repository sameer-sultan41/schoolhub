import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { parseTenantSlug } from "@/lib/host";
import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { ForgotPasswordForm } from "../forgot-password-form";
import { apiError } from "./link-test-support";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/host", () => ({ parseTenantSlug: jest.fn() }));
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { auth: { requestPasswordReset: jest.fn() } },
}));

const mockRequest = Services.auth.requestPasswordReset as jest.MockedFunction<
  typeof Services.auth.requestPasswordReset
>;
const mockParseTenantSlug = parseTenantSlug as jest.MockedFunction<typeof parseTenantSlug>;

async function submitEmail(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^email/i), email);
  await user.click(screen.getByRole("button", { name: /email me a link/i }));
}

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockReplace.mockReset();
    mockParseTenantSlug.mockReset().mockReturnValue("city");
    (toast.success as jest.Mock).mockReset();
  });

  it("refuses an address that is not an email before calling the API", async () => {
    renderWithProviders(<ForgotPasswordForm />);

    await submitEmail("not-an-email");

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("sends the school from the host with the email, then goes to /login with a toast", async () => {
    mockRequest.mockResolvedValue(undefined);
    renderWithProviders(<ForgotPasswordForm />);

    await submitEmail("staff@example.com");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    expect(mockRequest.mock.calls[0]?.[0]).toEqual({ school: "city", email: "staff@example.com" });
    expect(toast.success).toHaveBeenCalledWith(
      "If that email has an account here, a reset link is on its way. It works for one hour.",
    );
  });

  it("explains, without calling the API, when the page is not on a school's address", async () => {
    mockParseTenantSlug.mockReturnValue(null);
    renderWithProviders(<ForgotPasswordForm />);

    await submitEmail("staff@example.com");

    expect(
      await screen.findByText(
        "Open this page from your school's sign-in address to reset your password.",
      ),
    ).toBeInTheDocument();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("shows a throttled request's message instead of redirecting", async () => {
    mockRequest.mockRejectedValue(apiError("rate_limited", 429));
    renderWithProviders(<ForgotPasswordForm />);

    await submitEmail("staff@example.com");

    expect(
      await screen.findByText("Too many requests. Wait a moment and try again."),
    ).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
