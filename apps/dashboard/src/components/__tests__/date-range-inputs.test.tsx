import { fireEvent, render, screen } from "@testing-library/react";

import { DateRangeInputs } from "@/components/date-range-inputs";

function setup(props: { from?: string; to?: string } = {}) {
  const onChange = jest.fn();
  render(
    <DateRangeInputs
      from={props.from ?? ""}
      to={props.to ?? ""}
      fromLabel="From"
      toLabel="To"
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("DateRangeInputs", () => {
  it("bounds each date by the other", () => {
    setup({ from: "2026-10-01", to: "2026-10-31" });

    expect(screen.getByLabelText("From")).toHaveAttribute("max", "2026-10-31");
    expect(screen.getByLabelText("To")).toHaveAttribute("min", "2026-10-01");
  });

  it("leaves a date unbounded while the other is empty", () => {
    setup();

    expect(screen.getByLabelText("From")).not.toHaveAttribute("max");
    expect(screen.getByLabelText("To")).not.toHaveAttribute("min");
  });

  it("reports only the end that changed", () => {
    const onChange = setup({ from: "2026-10-01" });

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-09" } });

    expect(onChange).toHaveBeenLastCalledWith({ to: "2026-10-09" });
  });
});
