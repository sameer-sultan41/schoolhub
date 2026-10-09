import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperTrigger,
} from "../stepper";

function ThreeStepStepper({
  value,
  onValueChange,
}: {
  value: number;
  onValueChange: (v: number) => void;
}) {
  return (
    <Stepper value={value} onValueChange={onValueChange}>
      <StepperNav>
        {[1, 2, 3].map((step) => (
          <StepperItem key={step} step={step} disabled={step > value}>
            <StepperTrigger>
              <StepperIndicator>{step}</StepperIndicator>
            </StepperTrigger>
          </StepperItem>
        ))}
      </StepperNav>
      <StepperContent value={1}>One</StepperContent>
      <StepperContent value={2}>Two</StepperContent>
      <StepperContent value={3}>Three</StepperContent>
    </Stepper>
  );
}

describe("Stepper", () => {
  it("renders only the active step's content", () => {
    render(<ThreeStepStepper value={2} onValueChange={jest.fn()} />);

    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.queryByText("Three")).not.toBeInTheDocument();
  });

  it("marks steps before the active one as completed", () => {
    render(<ThreeStepStepper value={2} onValueChange={jest.fn()} />);

    const triggers = screen.getAllByRole("tab");
    expect(triggers[0]).toHaveAttribute("data-state", "completed");
    expect(triggers[1]).toHaveAttribute("data-state", "active");
    expect(triggers[2]).toHaveAttribute("data-state", "inactive");
  });

  it("disables a trigger for a step not yet reached", () => {
    render(<ThreeStepStepper value={2} onValueChange={jest.fn()} />);

    expect(screen.getAllByRole("tab")[2]).toBeDisabled();
  });

  it("calls onValueChange when an enabled trigger is clicked", async () => {
    const onValueChange = jest.fn();
    render(<ThreeStepStepper value={2} onValueChange={onValueChange} />);

    await userEvent.click(screen.getAllByRole("tab")[0] as HTMLElement);

    expect(onValueChange).toHaveBeenCalledWith(1);
  });
});
