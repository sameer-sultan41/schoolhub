import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, LoginResponse } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test-utils";
import { login } from "@/lib/auth";
import { LoginForm } from "./login-form";

function makeLoginResponse(): LoginResponse {
  const user: AuthenticatedUser = {
    id: "u1",
    email: "admin@cityschool.test",
    phone: null,
    full_name: "Ayesha Khan",
    avatar_url: null,
    locale: "en",
    tenant_id: "t1",
    roles: [],
    permissions: [],
  };
  return { access_token: "at-1", expires_in: 900, user };
}

const mockReplace = jest.fn();
const mockGet = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: mockGet }),
}));

jest.mock("@/lib/auth", () => ({
  login: jest.fn(),
}));

const mockLogin = login as jest.MockedFunction<typeof login>;

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
    renderWithProviders(<LoginForm />);

    expect(screen.getByLabelText(/email, phone, or username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("redirects to /dashboard on a successful sign-in with no next param", async () => {
    mockLogin.mockResolvedValue(makeLoginResponse());

    renderWithProviders(<LoginForm />);
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

    renderWithProviders(<LoginForm />);
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/students");
    });
  });

  it("ignores an off-site next param", async () => {
    mockGet.mockReturnValue("https://evil.example.com");
    mockLogin.mockResolvedValue(makeLoginResponse());

    renderWithProviders(<LoginForm />);
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

    renderWithProviders(<LoginForm />);
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

    renderWithProviders(<LoginForm />);
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

    renderWithProviders(<LoginForm />);
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(
        screen.getByText("Something went wrong on our side. The team has been notified."),
      ).toBeInTheDocument();
    });
  });
});
