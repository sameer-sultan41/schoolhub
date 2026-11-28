import type { ReactElement } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services, type SubscriptionState } from "@/services";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";
import {
  ALL_PLATFORM_KEYS,
  apiError,
  PLAN_ID,
  planRecord,
  platformUser,
  TENANT_ID,
  tenantRecord,
} from "@/features/platform/__tests__/platform-fixtures";

import { TenantOverridesTab } from "../overrides/tenant-overrides-tab";
import { TenantSubscriptionTab } from "../subscription/tenant-subscription-tab";
import { TenantUsageTab } from "../tenant-usage-tab";

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

const LIMITS = { students: 500, staff: 60, storage_gb: 20, sms_credits: null, ai_tokens: null };
const KEY = { idempotencyKey: expect.any(String) as string };

function subscription(status: "trialing" | "active" | "past_due"): SubscriptionState {
  return {
    tenant_status: status === "trialing" ? "trial" : status,
    trial_ends_at: null,
    limits: LIMITS,
    subscription: {
      id: "s1",
      plan: {
        id: PLAN_ID,
        code: "standard",
        name: "Standard",
        price_amount: "15000.00",
        currency: "PKR",
        billing_period: "monthly",
        enabled_modules: [],
      },
      status,
      current_period_start: "2026-11-01T00:00:00Z",
      current_period_end: "2026-12-01T00:00:00Z",
      canceled_at: null,
      billing_provider: "manual",
      billing_provider_ref: "",
      limits_override: null,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
  };
}

function renderTab(ui: ReactElement) {
  renderWithProviders(
    <>
      {ui}
      <UserLoaded />
    </>,
  );
  return userEvent.setup();
}

describe("the tenant's tabs", () => {
  beforeEach(() => {
    Object.values(platform).forEach((mock) => {
      mock.mockReset();
    });
    auth.fetchCurrentUser.mockReset().mockResolvedValue(platformUser(ALL_PLATFORM_KEYS));
    platform.fetchActivePlans.mockResolvedValue([
      planRecord(),
      planRecord({ id: "b1", code: "basic", name: "Basic" }),
    ]);
    platform.fetchAllFlags.mockResolvedValue([]);
    platform.fetchTenant.mockResolvedValue(tenantRecord());
  });

  describe("Subscription", () => {
    it("offers activation, with a plan to pick, to a school with no live subscription", async () => {
      platform.fetchSubscription.mockResolvedValue({
        tenant_status: "trial",
        trial_ends_at: "2026-12-08T00:00:00Z",
        subscription: null,
        limits: LIMITS,
      });
      platform.activateSubscription.mockResolvedValue(subscription("active"));
      const user = renderTab(<TenantSubscriptionTab tenant={tenantRecord()} />);

      expect(await screen.findByText(/no live subscription\. the trial ends/i)).toBeInTheDocument();
      await screen.findByText(USER_LOADED);
      expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Activate" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox", { name: "Plan" }));
      await user.click(await screen.findByRole("option", { name: "Standard" }));
      fireEvent.change(within(dialog).getByLabelText("Period starts"), {
        target: { value: "2026-12-01T00:00" },
      });
      fireEvent.change(within(dialog).getByLabelText("Period ends"), {
        target: { value: "2027-01-01T00:00" },
      });
      await user.click(within(dialog).getByRole("button", { name: "Activate subscription" }));

      await waitFor(() => {
        expect(platform.activateSubscription).toHaveBeenCalledWith(
          TENANT_ID,
          {
            plan_code: "standard",
            current_period_start: new Date("2026-12-01T00:00").toISOString(),
            current_period_end: new Date("2027-01-01T00:00").toISOString(),
          },
          KEY,
        );
      });
    });

    it("shows subscription_exists inline", async () => {
      platform.fetchSubscription.mockResolvedValue(subscription("trialing"));
      platform.activateSubscription.mockRejectedValue(
        apiError(409, "subscription_exists", "The school already has a live subscription."),
      );
      const user = renderTab(<TenantSubscriptionTab tenant={tenantRecord()} />);

      await user.click(await screen.findByRole("button", { name: "Activate" }));
      const dialog = await screen.findByRole("dialog");
      // A trialing subscription converts on its own plan: no plan to pick.
      expect(within(dialog).queryByRole("combobox", { name: "Plan" })).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Activate subscription" }));

      expect(
        await within(dialog).findByText(/already has a live subscription/i),
      ).toBeInTheDocument();
    });

    it("marks an active school's payment failed under one key", async () => {
      platform.fetchSubscription.mockResolvedValue(subscription("active"));
      platform.markPaymentFailed.mockResolvedValue(subscription("past_due"));
      const user = renderTab(<TenantSubscriptionTab tenant={tenantRecord({ status: "active" })} />);

      await user.click(await screen.findByRole("button", { name: "Mark payment failed" }));
      await user.click(await screen.findByRole("button", { name: "Mark failed" }));

      await waitFor(() => {
        expect(platform.markPaymentFailed).toHaveBeenCalledWith(TENANT_ID, KEY);
      });
    });

    it("records a payment through to the date given", async () => {
      platform.fetchSubscription.mockResolvedValue(subscription("past_due"));
      platform.recordPayment.mockResolvedValue(subscription("active"));
      const user = renderTab(
        <TenantSubscriptionTab tenant={tenantRecord({ status: "past_due" })} />,
      );

      await user.click(await screen.findByRole("button", { name: "Record payment" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Paid through"), {
        target: { value: "2027-01-01T00:00" },
      });
      await user.click(within(dialog).getByRole("button", { name: "Record payment" }));

      await waitFor(() => {
        expect(platform.recordPayment).toHaveBeenCalledWith(
          TENANT_ID,
          { paid_through: new Date("2027-01-01T00:00").toISOString() },
          KEY,
        );
      });
    });

    it("asks before moving to a plan below usage, then resends acknowledged", async () => {
      platform.fetchSubscription.mockResolvedValue(subscription("active"));
      platform.changePlan
        .mockRejectedValueOnce(
          apiError(409, "limit_below_usage", "Below usage.", {
            meta: { over_usage: [{ tenant_id: TENANT_ID, metric: "staff", limit: 10, usage: 42 }] },
          }),
        )
        .mockResolvedValueOnce(subscription("active"));
      const user = renderTab(<TenantSubscriptionTab tenant={tenantRecord({ status: "active" })} />);

      await user.click(await screen.findByRole("button", { name: "Change plan" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox", { name: "Plan" }));
      // The current plan isn't offered as a move.
      expect(screen.queryByRole("option", { name: "Standard" })).not.toBeInTheDocument();
      await user.click(await screen.findByRole("option", { name: "Basic" }));
      await user.click(within(dialog).getByRole("button", { name: "Change plan" }));

      const confirm = await screen.findByRole("alertdialog");
      expect(within(confirm).getByText(/staff: 42 in use, new limit 10/i)).toBeInTheDocument();
      // `meta.over_usage` carries only the tenant id; the dialog names the school.
      expect(await within(confirm).findByText("City School")).toBeInTheDocument();
      await user.click(within(confirm).getByRole("button", { name: "Save anyway" }));

      await waitFor(() => {
        expect(platform.changePlan).toHaveBeenCalledTimes(2);
      });
      expect(platform.changePlan.mock.calls[0]?.[1]).toEqual({
        plan_code: "basic",
        acknowledge_over_usage: false,
      });
      expect(platform.changePlan.mock.calls[1]?.[1]).toEqual({
        plan_code: "basic",
        acknowledge_over_usage: true,
      });
      // The acknowledged body is a different request, so a different key.
      expect(platform.changePlan.mock.calls[1]?.[2]).not.toEqual(
        platform.changePlan.mock.calls[0]?.[2],
      );
    });

    it("names the module a plan change would switch off, from toggle_refused's meta.flag", async () => {
      platform.fetchSubscription.mockResolvedValue(subscription("active"));
      platform.changePlan.mockRejectedValue(
        apiError(409, "toggle_refused", "Published timetables still use this module.", {
          meta: { flag: "module.timetable" },
        }),
      );
      const user = renderTab(<TenantSubscriptionTab tenant={tenantRecord({ status: "active" })} />);

      await user.click(await screen.findByRole("button", { name: "Change plan" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox", { name: "Plan" }));
      await user.click(await screen.findByRole("option", { name: "Basic" }));
      await user.click(within(dialog).getByRole("button", { name: "Change plan" }));

      expect(
        await within(dialog).findByText(
          "module.timetable can't be changed for this school: Published timetables still use this module.",
        ),
      ).toBeInTheDocument();
    });

    it("offers no billing action without platform.subscription.update", async () => {
      auth.fetchCurrentUser.mockResolvedValue(platformUser(["platform.subscription.view"]));
      platform.fetchSubscription.mockResolvedValue(subscription("active"));
      renderTab(<TenantSubscriptionTab tenant={tenantRecord({ status: "active" })} />);

      await screen.findByText(USER_LOADED);
      expect(await screen.findByText("Standard (standard), 15,000.00 PKR")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Change plan" })).not.toBeInTheDocument();
    });
  });

  describe("Feature overrides", () => {
    it("lists the school's overrides and names the flag a refused one is about", async () => {
      platform.fetchOverrides.mockResolvedValue([
        {
          id: "ov1",
          flag: "module.fees",
          enabled: true,
          reason: "Pilot",
          expires_at: null,
          created_at: "2026-11-01T00:00:00Z",
          created_by: null,
        },
      ]);
      platform.fetchAllFlags.mockResolvedValue([
        {
          id: "f1",
          key: "module.timetable",
          description: "",
          default_enabled: true,
          is_kill_switch: true,
          updated_at: "2026-11-01T00:00:00Z",
        },
      ]);
      // `flags/services.py`'s refusal of an override switching a kill switch on.
      platform.createOverride.mockRejectedValue(
        apiError(
          409,
          "toggle_refused",
          "A kill switch can only be turned on by its platform default, not per school.",
          {
            meta: { flag: "module.timetable" },
          },
        ),
      );
      const user = renderTab(<TenantOverridesTab tenant={tenantRecord()} />);

      expect(await screen.findByText("module.fees")).toBeInTheDocument();
      expect(screen.getByText("Never")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Add override" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox", { name: "Flag" }));
      await user.click(await screen.findByRole("option", { name: "module.timetable" }));
      await user.type(within(dialog).getByLabelText(/reason/i), "Support case 42");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(
        await within(dialog).findByText(
          /^module\.timetable can't be changed for this school: A kill switch/,
        ),
      ).toBeInTheDocument();
      expect(platform.createOverride).toHaveBeenCalledWith(TENANT_ID, {
        flag: "module.timetable",
        enabled: true,
        reason: "Support case 42",
        expires_at: null,
      });
    });

    it("removes an override", async () => {
      platform.fetchOverrides.mockResolvedValue([
        {
          id: "ov1",
          flag: "module.fees",
          enabled: false,
          reason: "Unpaid",
          expires_at: "2026-12-31T00:00:00Z",
          created_at: "2026-11-01T00:00:00Z",
          created_by: null,
        },
      ]);
      platform.deleteOverride.mockResolvedValue(undefined);
      const user = renderTab(<TenantOverridesTab tenant={tenantRecord()} />);

      await user.click(
        await screen.findByRole("button", { name: "Remove the module.fees override" }),
      );
      await user.click(await screen.findByRole("button", { name: "Remove override" }));

      await waitFor(() => {
        expect(platform.deleteOverride).toHaveBeenCalledWith(TENANT_ID, "ov1");
      });
    });
  });

  describe("Usage", () => {
    it("shows the snapshot against the limits, and takes a new one on Refresh", async () => {
      platform.fetchTenantUsage.mockResolvedValue({ snapshot: null, limits: LIMITS });
      platform.refreshTenantUsage.mockResolvedValue({
        limits: LIMITS,
        snapshot: {
          id: "u1",
          taken_at: new Date().toISOString(),
          status: "active",
          plan_code: "standard",
          mrr_amount: "15000.00",
          currency: "PKR",
          students: 320,
          staff: 41,
          storage_bytes: 5 * 1024 ** 3,
          impersonations_30d: null,
          modules_enabled: [],
        },
      });
      const user = renderTab(<TenantUsageTab tenant={tenantRecord()} />);

      expect(await screen.findByText(/no usage snapshot yet/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Refresh" }));

      expect(await screen.findByText("320 of 500")).toBeInTheDocument();
      expect(screen.getByText("41 of 60")).toBeInTheDocument();
      expect(screen.getByText("5 of 20")).toBeInTheDocument();
      expect(platform.refreshTenantUsage).toHaveBeenCalledWith(TENANT_ID);
    });
  });
});
