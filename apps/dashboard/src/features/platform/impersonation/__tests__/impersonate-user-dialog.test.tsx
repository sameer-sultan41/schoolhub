import { screen, waitFor, within } from "@testing-library/react";
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
import { TenantDetail } from "@/features/platform/tenants/tenant-detail";

import { ImpersonateUserAction } from "../impersonate-user-action";

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

const IMPERSONATE_KEYS: PermissionKey[] = [...ALL_PLATFORM_KEYS, "platform.tenant.impersonate"];
const AYESHA = {
  id: "0d6a1c4e-2b3f-4a5d-8e7f-9a0b1c2d3e4f",
  name: "Ayesha Khan",
  email: "ayesha@cityschool.test",
  roles: ["teacher"],
};
const BILAL = {
  id: "1e7b2d5f-3c4a-4b6e-9f8a-0b1c2d3e4f5a",
  name: "Bilal Ahmed",
  email: "bilal@cityschool.test",
  roles: ["school_admin"],
};
const STARTED = {
  grant_id: "8a9b0c1d-2e3f-4a5b-8c7d-6e5f4a3b2c1d",
  expires_at: "2026-11-28T10:30:00Z",
  handoff_url: "https://city-school.app.schoolhub.test/impersonate#school=city-school&code=c0de",
};

function renderDetail(tenant: TenantRecord, keys: PermissionKey[] = IMPERSONATE_KEYS) {
  auth.fetchCurrentUser.mockResolvedValue(platformUser(keys));
  platform.fetchTenant.mockResolvedValue(tenant);
  renderWithProviders(
    <>
      <TenantDetail
        tenantId={TENANT_ID}
        extraActions={<ImpersonateUserAction tenantId={TENANT_ID} />}
      />
      <UserLoaded />
    </>,
  );
  return userEvent.setup();
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Impersonate user" }));
  return screen.findByRole("dialog");
}

describe("ImpersonateUserAction", () => {
  beforeEach(() => {
    setUrl(`/platform/tenants/${TENANT_ID}`);
    Object.values(platform).forEach((mock) => {
      mock.mockReset();
    });
    auth.fetchCurrentUser.mockReset();
    platform.fetchActivePlans.mockResolvedValue([]);
    platform.fetchTenantUsers.mockImplementation((_tenantId, query) =>
      Promise.resolve({
        items: [AYESHA, BILAL].filter(
          (candidate) =>
            (!query.q || candidate.name.toLowerCase().includes(query.q.toLowerCase())) &&
            (!query.role || candidate.roles.includes(query.role)),
        ),
      }),
    );
  });

  it("is offered only with platform.tenant.impersonate", async () => {
    renderDetail(tenantRecord({ status: "active" }), ALL_PLATFORM_KEYS);

    await screen.findByText(USER_LOADED);
    await screen.findByRole("button", { name: "Suspend" });
    expect(screen.queryByRole("button", { name: "Impersonate user" })).not.toBeInTheDocument();
  });

  it.each<TenantRecord["status"]>(["provisioning", "suspended", "deprovisioned"])(
    "is not offered for a %s school, which can't be used",
    async (status) => {
      renderDetail(tenantRecord({ status, deprovision_after: null }));

      await screen.findByText(USER_LOADED);
      await screen.findByRole("heading", { name: "City School" });
      expect(screen.queryByRole("button", { name: "Impersonate user" })).not.toBeInTheDocument();
    },
  );

  it("picks a user from the school's list, searched by name", async () => {
    const user = renderDetail(tenantRecord({ status: "trial" }));
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByRole("textbox", { name: "Search users" }), "ayesha");

    await waitFor(() => {
      expect(platform.fetchTenantUsers).toHaveBeenLastCalledWith(
        TENANT_ID,
        expect.objectContaining({ q: "ayesha" }),
      );
    });
    await user.click(within(dialog).getByRole("combobox", { name: "User" }));
    expect(
      await screen.findByRole("option", { name: "Ayesha Khan (ayesha@cityschool.test)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Bilal Ahmed/ })).not.toBeInTheDocument();
  });

  it("starts a session with the user, reason and duration, then links to the school's dashboard", async () => {
    platform.impersonateUser.mockResolvedValue(STARTED);
    const user = renderDetail(tenantRecord({ status: "active" }));
    const dialog = await openDialog(user);

    const start = within(dialog).getByRole("button", { name: "Start session" });
    expect(start).toBeDisabled();
    await user.click(within(dialog).getByRole("combobox", { name: "User" }));
    await user.click(await screen.findByRole("option", { name: /Ayesha Khan/ }));
    await user.type(within(dialog).getByLabelText(/reason/i), "Ticket 42: report card layout");
    await user.click(start);

    await waitFor(() => {
      expect(platform.impersonateUser).toHaveBeenCalledWith(TENANT_ID, {
        user_id: AYESHA.id,
        reason: "Ticket 42: report card layout",
        duration_minutes: 30,
      });
    });
    const open = await screen.findByRole("link", { name: /open city school's dashboard/i });
    expect(open).toHaveAttribute("href", STARTED.handoff_url);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", expect.stringContaining("noopener") as string);
    expect(open).toHaveAttribute("rel", expect.stringContaining("noreferrer") as string);
  });

  it("keeps a refusal inline, with the dialog open", async () => {
    platform.impersonateUser.mockRejectedValue(
      // A string `detail` arrives as a `non_field` issue (`core/api/exceptions.py`).
      apiError(422, "domain_rule_violation", "The user is not an active user of this school.", {
        details: [{ field: "non_field", issue: "The user is not an active user of this school." }],
      }),
    );
    const user = renderDetail(tenantRecord({ status: "active" }));
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole("combobox", { name: "User" }));
    await user.click(await screen.findByRole("option", { name: /Bilal Ahmed/ }));
    await user.type(within(dialog).getByLabelText(/reason/i), "Checking a fee screen");
    await user.click(within(dialog).getByRole("button", { name: "Start session" }));

    expect(
      await within(dialog).findByText("The user is not an active user of this school."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open city school's dashboard/i })).toBeNull();
  });
});
