import { ApiError } from "@schoolhub/api-client";
import type { LoginResponse } from "@schoolhub/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../../../messages/en.json";
import { Services } from "@/services";
import { LoginForm } from "../login-form";

function renderLoginForm(ui: ReactElement = <LoginForm />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function makeLoginResponse(): LoginResponse {
  return {
    access_token: "at-1",
    expires_in: 900,
    user: {
      id: "u1",
      email: "admin@cityschool.test",
      phone: null,
      full_name: "Ayesha Khan",
      avatar_url: null,
      locale: "en",
      tenant_id: "t1",
      roles: [],
      permissions: [],
    },
  };
}

const mockReplace = jest.fn();
const mockGet = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: mockGet }),
}));

jest.mock("@/services", () => ({
  Services: { auth: { login: jest.fn() } },
}));

const mockLogin = Services.auth.login as jest.MockedFunction<typeof Services.auth.login>;

async function fillAndSubmit(identifier: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email, phone, or username/i), identifier);
  await user.type(screen.getByLabelText(/^password/i), password);
  await user.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockReplace.mockReset();
    mockGet.mockReset().mockReturnValue(null);
  });

  it("renders the sign-in fields", () => {
    renderLoginForm();

    expect(screen.getByLabelText(/email, phone, or username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("toggles the password field's visibility", async () => {
    renderLoginForm();
    const user = userEvent.setup();
    const passwordInput = screen.getByLabelText(/^password/i);
    expect(passwordInput).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(passwordInput).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("redirects to /dashboard on a successful sign-in with no next param", async () => {
    mockLogin.mockResolvedValue(makeLoginResponse());

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
    // TanStack Query's useMutation calls mutationFn with a second (context) argument
    // beyond the variables — assert on the first call's first argument directly rather
    // than via toHaveBeenCalledWith, which requires every argument to match.
    expect(mockLogin.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ identifier: "admin@cityschool.test", password: "secret123" }),
    );
  });

  it("redirects to a same-origin next param when present", async () => {
    mockGet.mockReturnValue("/students");
    mockLogin.mockResolvedValue(makeLoginResponse());

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/students");
    });
  });

  it("ignores an off-site next param", async () => {
    mockGet.mockReturnValue("https://evil.example.com");
    mockLogin.mockResolvedValue(makeLoginResponse());

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("maps a field-level API error onto the matching form field", async () => {
    mockLogin.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid",
        status: 422,
        url: "/login",
        details: [{ field: "identifier", issue: "No account with that identifier." }],
      }),
    );

    renderLoginForm();
    await fillAndSubmit("nobody", "secret123");

    await waitFor(() => {
      expect(screen.getByText("No account with that identifier.")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the generic error banner on 401", async () => {
    mockLogin.mockRejectedValue(
      new ApiError({
        code: "unauthenticated",
        message: "bad credentials",
        status: 401,
        url: "/login",
      }),
    );

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "wrong");

    await waitFor(() => {
      expect(
        screen.getByText("We could not sign you in. Check your details and try again."),
      ).toBeInTheDocument();
    });
  });

  it("shows a mapped error message for a known error code", async () => {
    mockLogin.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/login" }),
    );

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(
        screen.getByText("Something went wrong on our side. The team has been notified."),
      ).toBeInTheDocument();
    });
  });
});
