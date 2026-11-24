import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { saveBlob } from "@/lib/helpers";
import { Services } from "@/services";
import { renderWithProviders, setUrl } from "@/test-utils";

import { FlagsSection } from "../feature-flags/flags-section";
import { PlansSection } from "../plans/plans-section";
import { ReportsSection } from "../reports/reports-section";
import {
  ALL_PLATFORM_KEYS,
  apiError,
  onePage,
  PLAN_ID,
  planRecord,
  platformUser,
} from "./platform-fixtures";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<Record<string, unknown>>("@/lib/helpers"),
  saveBlob: jest.fn(),
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ platformServicesMock: () => unknown }>("./platform-services-mock")
    .platformServicesMock(),
);

const auth = Services.auth as jest.Mocked<typeof Services.auth>;
const platform = Services.platform as jest.Mocked<typeof Services.platform>;

const FLAG = {
  id: "f1",
  key: "module.timetable",
  description: "Timetable module",
  default_enabled: true,
  is_kill_switch: false,
  updated_at: "2026-11-01T00:00:00Z",
};

beforeEach(() => {
  Object.values(platform).forEach((mock) => {
    mock.mockReset();
  });
  auth.fetchCurrentUser.mockReset().mockResolvedValue(platformUser(ALL_PLATFORM_KEYS));
  platform.fetchAllFlags.mockResolvedValue([FLAG]);
});

describe("PlansSection", () => {
  beforeEach(() => {
    setUrl("/platform/plans");
    platform.fetchPlanPage.mockResolvedValue(onePage([planRecord()]));
  });

  it("lists the active plans by default, priced per period", async () => {
    renderWithProviders(<PlansSection />);

    expect(await screen.findByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("15,000.00 PKR / month")).toBeInTheDocument();
    expect(platform.fetchPlanPage).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
    );
  });

  it("shows plan_in_use inline when retiring a plan a school is on", async () => {
    platform.retirePlan.mockRejectedValue(
      apiError(409, "plan_in_use", "A school is on this plan."),
    );
    renderWithProviders(<PlansSection />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Retire Standard" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Retire plan" }));

    expect(await within(confirm).findByText(/a school is still on this plan/i)).toBeInTheDocument();
    expect(platform.retirePlan).toHaveBeenCalledWith(PLAN_ID);
  });

  it("creates a plan with its modules and every limit, blank as unlimited", async () => {
    platform.createPlan.mockResolvedValue(planRecord({ name: "Pro", code: "pro" }));
    renderWithProviders(<PlansSection />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New plan" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Plan name"), "Pro");
    await user.type(within(dialog).getByLabelText("Code"), "pro");
    await user.type(within(dialog).getByLabelText("Price per period"), "25000");
    await user.type(within(dialog).getByLabelText("Students limit"), "1000");
    await user.click(await within(dialog).findByRole("checkbox", { name: "module.timetable" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(platform.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Pro",
          code: "pro",
          price_amount: "25000",
          currency: "PKR",
          trial_days: 14,
          enabled_modules: ["module.timetable"],
          limits: {
            students: 1000,
            staff: null,
            storage_gb: null,
            sms_credits: null,
            ai_tokens: null,
          },
        }),
      );
    });
  });
});

describe("FlagsSection", () => {
  it("sets a flag's platform default for every school", async () => {
    setUrl("/platform/feature-flags");
    platform.fetchFlagPage.mockResolvedValue(onePage([FLAG]));
    platform.updateFlag.mockResolvedValue({ ...FLAG, default_enabled: false });
    renderWithProviders(<FlagsSection />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Edit module.timetable" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("switch", { name: "On by default" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(platform.updateFlag).toHaveBeenCalledWith("f1", {
        default_enabled: false,
        is_kill_switch: false,
      });
    });
  });
});

describe("ReportsSection", () => {
  it("renders the chosen report's sections and downloads it as CSV", async () => {
    setUrl("/platform/reports?report=revenue");
    platform.fetchReport.mockResolvedValue({
      key: "revenue",
      title: "Revenue",
      generated_at: new Date().toISOString(),
      sections: { mrr_by_plan: [{ plan_code: "standard", schools: 3, mrr: 45000 }] },
    });
    const blob = new Blob(["plan_code,schools"]);
    platform.downloadReport.mockResolvedValue(blob);
    renderWithProviders(<ReportsSection />);
    const user = userEvent.setup();

    expect(await screen.findByRole("table", { name: "Mrr by plan" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "45,000" })).toBeInTheDocument();
    expect(platform.fetchReport).toHaveBeenCalledWith("revenue");

    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    await waitFor(() => {
      expect(saveBlob).toHaveBeenCalledWith(blob, "revenue.csv");
    });
  });
});
