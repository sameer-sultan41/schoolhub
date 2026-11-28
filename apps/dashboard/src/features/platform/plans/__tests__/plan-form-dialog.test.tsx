import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import {
  apiError,
  PLAN_ID,
  planRecord,
  TENANT_ID,
} from "@/features/platform/__tests__/platform-fixtures";

import { PlanFormDialog } from "../plan-form-dialog";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    platform: { createPlan: jest.fn(), updatePlan: jest.fn(), fetchAllFlags: jest.fn() },
  },
}));

const platform = Services.platform as jest.Mocked<typeof Services.platform>;

/** `apps/api/apps/platform_admin/usage/limits.py`'s 409, verbatim in shape. */
const LIMIT_BELOW_USAGE = apiError(
  409,
  "limit_below_usage",
  "This limit is below a school's current usage. Send acknowledge_over_usage: true to lower it anyway.",
  {
    meta: {
      over_usage: [
        {
          tenant_id: TENANT_ID,
          tenant_name: "City School",
          slug: "city-school",
          metric: "students",
          limit: 100,
          usage: 320,
        },
      ],
    },
  },
);

async function lowerStudentsLimitAndSave() {
  const onOpenChange = jest.fn();
  renderWithProviders(<PlanFormDialog open onOpenChange={onOpenChange} plan={planRecord()} />);
  const user = userEvent.setup();
  const students = await screen.findByLabelText("Students limit");
  await user.clear(students);
  await user.type(students, "100");
  await user.click(screen.getByRole("button", { name: "Save" }));
  return { user, onOpenChange };
}

describe("PlanFormDialog, lowering a limit below usage", () => {
  beforeEach(() => {
    platform.createPlan.mockReset();
    platform.updatePlan.mockReset();
    platform.fetchAllFlags.mockReset().mockResolvedValue([]);
  });

  it("asks for an acknowledgement naming each breach, and resends with it", async () => {
    platform.updatePlan
      .mockRejectedValueOnce(LIMIT_BELOW_USAGE)
      .mockResolvedValueOnce(planRecord({ limits: { ...planRecord().limits, students: 100 } }));
    const { user, onOpenChange } = await lowerStudentsLimitAndSave();

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/students/i)).toBeInTheDocument();
    expect(within(confirm).getByText(/320/)).toBeInTheDocument();
    // Nothing is saved until the operator acknowledges.
    expect(platform.updatePlan).toHaveBeenCalledTimes(1);
    expect(platform.updatePlan.mock.calls[0]?.[1]).not.toHaveProperty("acknowledge_over_usage");

    await user.click(within(confirm).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => {
      expect(platform.updatePlan).toHaveBeenCalledTimes(2);
    });
    expect(platform.updatePlan.mock.calls[1]?.[0]).toBe(PLAN_ID);
    expect(platform.updatePlan.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        acknowledge_over_usage: true,
        limits: expect.objectContaining({ students: 100 }) as unknown,
      }),
    );
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("keeps the form open and unsaved when the acknowledgement is cancelled", async () => {
    platform.updatePlan.mockRejectedValueOnce(LIMIT_BELOW_USAGE);
    const { user, onOpenChange } = await lowerStudentsLimitAndSave();

    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(platform.updatePlan).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Students limit")).toHaveValue("100");
  });
});
