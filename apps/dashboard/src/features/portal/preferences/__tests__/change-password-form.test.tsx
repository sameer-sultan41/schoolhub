import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { ChangePasswordForm } from "../change-password-form";

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({ auth: ["changePassword"] }),
);

const CURRENT = "old-password-1";
const NEXT = "a-better-password-2";

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  { current = CURRENT, next = NEXT, confirm = NEXT } = {},
) {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
}

describe("ChangePasswordForm", () => {
  beforeEach(() => {
    mocked(Services.auth.changePassword).mockReset();
  });

  it("sends the current and new password, never the confirmation, and clears the form", async () => {
    mocked(Services.auth.changePassword).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(Services.auth.changePassword).toHaveBeenCalledWith({
        current_password: CURRENT,
        new_password: NEXT,
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toHaveValue("");
    });
  });

  it("refuses a short password before asking the server", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm />);

    await fill(user, { next: "short", confirm: "short" });
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(
      await screen.findByText("The new password must be at least 10 characters."),
    ).toBeInTheDocument();
    expect(Services.auth.changePassword).not.toHaveBeenCalled();
  });

  it("refuses a confirmation that differs", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm />);

    await fill(user, { confirm: "something-else-3" });
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument();
    expect(Services.auth.changePassword).not.toHaveBeenCalled();
  });

  it("refuses a new password equal to the current one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm />);

    await fill(user, { next: CURRENT, confirm: CURRENT });
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(
      await screen.findByText("Choose a password different from the current one."),
    ).toBeInTheDocument();
    expect(Services.auth.changePassword).not.toHaveBeenCalled();
  });

  it("shows the server's refusal under the field it names", async () => {
    mocked(Services.auth.changePassword).mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid input.",
        status: 400,
        url: "/auth/change-password",
        details: [{ field: "current_password", issue: "Current password is incorrect." }],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Current password is incorrect.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue(NEXT);
  });
});
