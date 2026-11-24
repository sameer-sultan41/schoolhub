import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { apiError, TENANT_ID, tenantRecord } from "@/features/platform/__tests__/platform-fixtures";

import { TenantReasonDialog } from "../tenant-reason-dialog";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { platform: { suspendTenant: jest.fn(), restoreTenant: jest.fn() } },
}));

const platform = Services.platform as jest.Mocked<typeof Services.platform>;

function renderSuspend(onOpenChange = jest.fn()) {
  renderWithProviders(
    <TenantReasonDialog
      action="suspend"
      tenant={tenantRecord()}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { user: userEvent.setup(), onOpenChange };
}

describe("TenantReasonDialog (suspend)", () => {
  beforeEach(() => {
    platform.suspendTenant.mockReset();
    platform.restoreTenant.mockReset();
  });

  it("keeps Suspend disabled until a reason is written", async () => {
    const { user } = renderSuspend();
    const submit = screen.getByRole("button", { name: "Suspend school" });

    expect(submit).toBeDisabled();
    // Whitespace is not a reason: the server refuses a blank one.
    await user.type(screen.getByLabelText(/reason/i), "   ");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/reason/i), "Unpaid since October");
    expect(submit).toBeEnabled();
  });

  it("sends the reason with an Idempotency-Key and closes on success", async () => {
    platform.suspendTenant.mockResolvedValue(tenantRecord({ status: "suspended" }));
    const { user, onOpenChange } = renderSuspend();

    await user.type(screen.getByLabelText(/reason/i), "Unpaid since October");
    await user.click(screen.getByRole("button", { name: "Suspend school" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(platform.suspendTenant).toHaveBeenCalledWith(
      TENANT_ID,
      { reason: "Unpaid since October" },
      { idempotencyKey: expect.any(String) as string },
    );
  });

  it("shows the server's refusal inline and retries under the same key", async () => {
    platform.suspendTenant
      .mockRejectedValueOnce(
        apiError(409, "invalid_transition", "A deprovisioned school can't be suspended."),
      )
      .mockResolvedValueOnce(tenantRecord({ status: "suspended" }));
    const { user } = renderSuspend();

    await user.type(screen.getByLabelText(/reason/i), "Unpaid since October");
    await user.click(screen.getByRole("button", { name: "Suspend school" }));

    expect(await screen.findByText(/can't move to that status/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Suspend school" }));
    await waitFor(() => {
      expect(platform.suspendTenant).toHaveBeenCalledTimes(2);
    });
    const [first, second] = platform.suspendTenant.mock.calls;
    expect(second?.[2]).toEqual(first?.[2]);
  });
});
