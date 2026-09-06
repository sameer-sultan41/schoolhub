import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Users } from "lucide-react";
import { StatCard } from "./stat-card";

const base = {
  label: "Enrolled students",
  value: "248",
  unavailableLabel: "Not available yet",
} as const;

describe("StatCard", () => {
  it("shows the figure when it is ready", () => {
    render(<StatCard {...base} state="ready" />);

    expect(screen.getByText("Enrolled students")).toBeInTheDocument();
    expect(screen.getByText("248")).toBeInTheDocument();
  });

  it("shows a skeleton while loading, not a placeholder dash", () => {
    // A dash is indistinguishable from "we asked and the answer is nothing", which is a
    // different fact. The skeleton also holds the figure's height so the tile does not
    // resize when the number arrives.
    const { container } = render(<StatCard {...base} state="loading" />);

    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByText("248")).not.toBeInTheDocument();
  });

  it("says plainly when there is no source for the figure yet", () => {
    render(<StatCard {...base} label="Attendance today" state="unavailable" />);

    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(screen.queryByText("248")).not.toBeInTheDocument();
  });

  it("does not announce an unavailable figure as an error", () => {
    // The old dashboard rendered a red alert for every metric whose module does not exist
    // yet — three of its four tiles. Nothing is broken; the module is simply not built.
    render(<StatCard {...base} state="unavailable" />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the icon out of the accessible name", () => {
    const { container } = render(<StatCard {...base} state="ready" icon={Users} />);

    expect(container.querySelector("svg")?.closest("[aria-hidden]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("renders a footer when one is given", () => {
    render(<StatCard {...base} state="ready" footer={<span>12 joined this term</span>} />);
    expect(screen.getByText("12 joined this term")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<StatCard {...base} state="ready" icon={Users} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
