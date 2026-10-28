import { screen, within } from "@testing-library/react";

import { correctionRecord } from "@/services/modules/attendance-corrections/__tests__/attendance-corrections-fixtures";
import { renderWithProviders } from "@/test-utils";

import { CorrectionDiff } from "../correction-diff";

describe("CorrectionDiff", () => {
  it("shows a staff row's holiday as its badge, like any other status", () => {
    renderWithProviders(
      <CorrectionDiff
        correction={correctionRecord({
          subject_type: "staff",
          student_name: null,
          staff_name: "Nadia Hussain",
          old_values: { status: "holiday", check_in_time: null },
          new_values: { status: "present" },
        })}
      />,
    );

    const line = within(screen.getByRole("listitem"));
    expect(line.getByText("Status")).toBeInTheDocument();
    // A badge carries an icon beside its label: the raw value would be bare text "holiday".
    expect(line.getByText("Holiday")).toBeInTheDocument();
    expect(line.queryByText("holiday")).not.toBeInTheDocument();
    expect(line.getByText("Present")).toBeInTheDocument();
  });

  it("still shows a value that is no status as text", () => {
    renderWithProviders(
      <CorrectionDiff
        correction={correctionRecord({
          old_values: { status: "unknown" },
          new_values: { status: "present" },
        })}
      />,
    );

    expect(screen.getByText("unknown")).toBeInTheDocument();
  });
});
