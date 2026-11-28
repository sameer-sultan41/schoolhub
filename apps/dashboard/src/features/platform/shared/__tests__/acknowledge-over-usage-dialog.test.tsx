import { screen, within } from "@testing-library/react";

import { Services, type OverUsage } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { AcknowledgeOverUsageDialog } from "../acknowledge-over-usage-dialog";

jest.mock("@/services", () =>
  jest
    .requireActual<{ platformServicesMock: () => unknown }>(
      "@/features/platform/__tests__/platform-services-mock",
    )
    .platformServicesMock(),
);

const platform = Services.platform as jest.Mocked<typeof Services.platform>;

/** `usage/limits.py`'s `breaches`: each entry names its school. */
function breach(n: number, metric = "students"): OverUsage {
  return {
    tenant_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    tenant_name: `School ${n}`,
    slug: `school-${n}`,
    metric,
    limit: 100,
    usage: 100 + n,
  };
}

function renderDialog(breaches: OverUsage[]) {
  renderWithProviders(
    <AcknowledgeOverUsageDialog
      breaches={breaches}
      onCancel={jest.fn()}
      resend={jest.fn()}
      onSaved={jest.fn()}
    />,
  );
  return screen.getByRole("alertdialog");
}

describe("AcknowledgeOverUsageDialog", () => {
  beforeEach(() => {
    platform.fetchTenant.mockReset();
  });

  it("names each school from the refusal itself, with no request per school", () => {
    const dialog = renderDialog([breach(1), breach(1, "staff"), breach(2)]);

    expect(within(dialog).getByText("School 1")).toBeInTheDocument();
    expect(within(dialog).getByText("School 2")).toBeInTheDocument();
    expect(within(dialog).getByText(/staff: 101 in use, new limit 100/i)).toBeInTheDocument();
    expect(platform.fetchTenant).not.toHaveBeenCalled();
  });

  it("lists at most 20 schools, then says how many more there are", () => {
    const dialog = renderDialog(Array.from({ length: 23 }, (_, index) => breach(index + 1)));

    expect(within(dialog).getByText("School 20")).toBeInTheDocument();
    expect(within(dialog).queryByText("School 21")).not.toBeInTheDocument();
    expect(within(dialog).getByText("and 3 more schools")).toBeInTheDocument();
  });
});
