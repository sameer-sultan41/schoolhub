import type { ReactNode } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";

import { Services, type TenantRecord } from "@/services";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders, setUrl } from "@/test-utils";
import {
  ALL_PLATFORM_KEYS,
  apiError,
  platformUser,
  TENANT_ID,
  tenantRecord,
} from "@/features/platform/__tests__/platform-fixtures";

import { TenantDetail } from "../tenant-detail";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () =>
  jest
    .requireActual<{ platformServicesMock: () => unknown }>(
      "@/features/platform/__tests__/platform-services-mock",
    )
    .platformServicesMock(),
);

const auth = Services.auth as jest.Mocked<typeof Services.auth>;
const platform = Services.platform as jest.Mocked<typeof Services.platform>;

const NO_LIMITS = {
  students: null,
  staff: null,
  storage_gb: null,
  sms_credits: null,
  ai_tokens: null,
};

function renderDetail(
  tenant: TenantRecord,
  keys: PermissionKey[] = ALL_PLATFORM_KEYS,
  extraActions?: ReactNode,
) {
  auth.fetchCurrentUser.mockResolvedValue(platformUser(keys));
  platform.fetchTenant.mockResolvedValue(tenant);
  renderWithProviders(
    <>
      <TenantDetail tenantId={TENANT_ID} extraActions={extraActions} />
      <UserLoaded />
    </>,
  );
  return userEvent.setup();
}

describe("TenantDetail", () => {
  beforeEach(() => {
    setUrl(`/platform/tenants/${TENANT_ID}`);
    Object.values(platform).forEach((mock) => {
      mock.mockReset();
    });
    auth.fetchCurrentUser.mockReset();
    platform.fetchActivePlans.mockResolvedValue([]);
    platform.fetchTenantUsage.mockResolvedValue({ snapshot: null, limits: NO_LIMITS });
  });

  it("names the school, its subdomain and its status in a live region", async () => {
    renderDetail(tenantRecord());

    expect(await screen.findByRole("heading", { name: "City School" })).toBeInTheDocument();
    expect(screen.getByText("city-school")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "School status" })).toHaveTextContent("Trial");
  });

  it.each<[TenantRecord["status"], string[], string[]]>([
    ["provisioning", ["Edit details", "Provision", "Delete"], ["Suspend", "Reinstate"]],
    ["trial", ["Edit details", "Suspend"], ["Provision", "Delete", "Reinstate"]],
    ["active", ["Suspend", "Delete"], ["Provision", "Reinstate"]],
    ["suspended", ["Reinstate", "Delete"], ["Suspend", "Provision"]],
  ])("offers only the moves the lifecycle allows from %s", async (status, shown, hidden) => {
    renderDetail(tenantRecord({ status }));

    for (const name of shown) {
      expect(await screen.findByRole("button", { name })).toBeInTheDocument();
    }
    await screen.findByText(USER_LOADED);
    for (const name of hidden) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("hides an action the operator has no key for, and renders the extra-actions slot", async () => {
    renderDetail(tenantRecord({ status: "active" }), ["platform.tenant.view"], <span>slot</span>);

    expect(await screen.findByText("slot")).toBeInTheDocument();
    // Only once the operator's keys are known can a missing button mean a missing key.
    await screen.findByText(USER_LOADED);
    await screen.findByRole("heading", { name: "City School" });
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("offers Restore only while the retention window is open", async () => {
    renderDetail(
      tenantRecord({ status: "deprovisioned", deprovision_after: "2999-01-01T00:00:00Z" }),
    );

    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("says a school does not exist on a 404", async () => {
    auth.fetchCurrentUser.mockResolvedValue(platformUser(ALL_PLATFORM_KEYS));
    platform.fetchTenant.mockRejectedValue(apiError(404, "not_found", "Not found."));

    renderWithProviders(<TenantDetail tenantId={TENANT_ID} />);

    expect(await screen.findByText(/doesn't exist, or was removed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to schools" })).toHaveAttribute(
      "href",
      "/platform/tenants",
    );
  });

  it("provisions on the picked plan under an Idempotency-Key", async () => {
    platform.fetchActivePlans.mockResolvedValue([]);
    platform.provisionTenant.mockResolvedValue(tenantRecord({ status: "trial" }));
    const user = renderDetail(tenantRecord({ status: "provisioning" }));

    await user.click(await screen.findByRole("button", { name: "Provision" }));
    await user.click(await screen.findByRole("button", { name: "Provision school" }));

    await waitFor(() => {
      expect(platform.provisionTenant).toHaveBeenCalledWith(
        TENANT_ID,
        {},
        { idempotencyKey: expect.any(String) as string },
      );
    });
  });

  it("shows grace_expired inline when reinstating a past-due school", async () => {
    platform.reinstateTenant.mockRejectedValue(
      apiError(409, "grace_expired", "This school's payment grace has run out."),
    );
    const user = renderDetail(tenantRecord({ status: "suspended" }));

    await user.click(await screen.findByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reinstate school" }));

    expect(
      await within(dialog).findByText(/record a payment before reinstating/i),
    ).toBeInTheDocument();
    expect(platform.reinstateTenant.mock.calls[0]?.[1]).toEqual({ reason: "" });
  });

  it("puts a past trial end's 400 under the field", async () => {
    platform.reinstateTenant.mockRejectedValue(
      apiError(400, "validation_error", "Invalid input.", {
        details: [{ field: "trial_ends_at", issue: "Must be in the future." }],
      }),
    );
    const user = renderDetail(tenantRecord({ status: "suspended" }));

    await user.click(await screen.findByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");
    // A datetime-local takes its whole value at once: typed character by character, jsdom sanitises
    // each partial value to "".
    fireEvent.change(within(dialog).getByLabelText("Trial ends"), {
      target: { value: "2020-01-01T10:00" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Reinstate school" }));

    expect(await within(dialog).findByText("Must be in the future.")).toBeInTheDocument();
    expect(platform.reinstateTenant.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ trial_ends_at: new Date("2020-01-01T10:00").toISOString() }),
    );
  });

  it("deletes with a waiver, or says export_required without one", async () => {
    platform.deleteTenant
      .mockRejectedValueOnce(apiError(409, "export_required", "Export first."))
      .mockResolvedValueOnce(tenantRecord({ status: "deprovisioned" }));
    const user = renderDetail(tenantRecord({ status: "active" }));

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Delete school" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/reason/i), "School closed");
    await user.click(submit);

    expect(
      await within(dialog).findByText(/export this school's data before deleting/i),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: /delete without an export/i }));
    await user.click(submit);

    await waitFor(() => {
      expect(platform.deleteTenant).toHaveBeenLastCalledWith(
        TENANT_ID,
        { reason: "School closed", waive_export: true },
        { idempotencyKey: expect.any(String) as string },
      );
    });
  });

  it("exports first, polling the job until its download link is ready", async () => {
    platform.exportTenant.mockResolvedValue({ jobId: "job-1" });
    platform.fetchTenantJob.mockResolvedValue({
      id: "job-1",
      job_type: "tenant_export",
      status: "succeeded",
      progress: 100,
      result: null,
      error: null,
      started_at: null,
      finished_at: null,
      created_at: "2026-11-24T09:00:00Z",
      updated_at: "2026-11-24T09:01:00Z",
      download_url: "https://storage.test/export.zip",
    });
    const user = renderDetail(tenantRecord({ status: "suspended" }));

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Export first" }));

    expect(await within(dialog).findByText(/the export is ready/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Download the export" })).toBeInTheDocument();
    expect(platform.fetchTenantJob).toHaveBeenCalledWith(TENANT_ID, "job-1");
  });
});
