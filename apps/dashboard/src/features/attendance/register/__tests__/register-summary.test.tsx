import { screen, within } from "@testing-library/react";

import { renderWithProviders } from "@/test-utils";

import { RegisterSummary } from "../register-summary";
import type { RegisterCounts } from "../use-register-form";

const NONE: RegisterCounts = {
  present: 0,
  absent: 0,
  late: 0,
  half_day: 0,
  excused: 0,
  on_leave: 0,
  unmarked: 0,
};

function renderSummary(counts: Partial<RegisterCounts>) {
  renderWithProviders(
    <RegisterSummary
      counts={{ ...NONE, ...counts }}
      showActions={false}
      unmarkedEditable={0}
      canSubmit={false}
      isSubmitting={false}
      onMarkAllPresent={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );
  const summary = screen.getByRole("region", { name: "Register summary" });
  // Each count as "label: value", in the order shown.
  return within(summary)
    .getAllByRole("term")
    .map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`);
}

describe("RegisterSummary", () => {
  it("shows present and unmarked even at zero, and no other status", () => {
    expect(renderSummary({})).toEqual(["Present: 0", "Unmarked: 0"]);
  });

  it("counts every status a row has, each under its own label, in the enum's order", () => {
    expect(
      renderSummary({
        present: 20,
        absent: 2,
        late: 1,
        half_day: 1,
        excused: 3,
        on_leave: 1,
        unmarked: 4,
      }),
    ).toEqual([
      "Present: 20",
      "Absent: 2",
      "Late: 1",
      "Half day: 1",
      "Excused: 3",
      "On leave: 1",
      "Unmarked: 4",
    ]);
  });

  it("leaves out a status no row has, and never folds one into an 'other' count", () => {
    expect(renderSummary({ present: 5, excused: 2, unmarked: 1 })).toEqual([
      "Present: 5",
      "Excused: 2",
      "Unmarked: 1",
    ]);
  });
});
