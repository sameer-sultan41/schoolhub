import { render, screen } from "@testing-library/react";
import { ScreenHeader } from "@/components/screen-header";

/** The flex row holding the title block and, when there is one, the actions block. */
function titleRow(container: HTMLElement): Element {
  const row = container.firstElementChild?.firstElementChild;
  if (!row) throw new Error("ScreenHeader rendered no title row");
  return row;
}

describe("ScreenHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<ScreenHeader title="Students" />);

    expect(screen.getByRole("heading", { level: 1, name: "Students" })).toBeInTheDocument();
  });

  it("renders the description when given one", () => {
    render(<ScreenHeader title="Students" description="Profiles, guardians, and enrollment." />);

    expect(screen.getByText("Profiles, guardians, and enrollment.")).toBeInTheDocument();
  });

  it("omits the description paragraph entirely when there is none", () => {
    const { container } = render(<ScreenHeader title="Students" />);

    expect(container.querySelector("p")).toBeNull();
  });

  it("caps the description by measure, which is what keeps the Urdu build readable", () => {
    render(<ScreenHeader title="Students" description="Profiles, guardians, and enrollment." />);

    expect(screen.getByText("Profiles, guardians, and enrollment.")).toHaveClass("max-w-prose");
  });

  it("renders the actions beside the title, not below it", () => {
    const { container } = render(
      <ScreenHeader title="Students" actions={<button type="button">New student</button>} />,
    );

    expect(screen.getByRole("button", { name: "New student" })).toBeInTheDocument();
    // The title block and the actions block, side by side in the same row.
    expect(titleRow(container).children).toHaveLength(2);
  });

  it("omits the actions row when there are no actions", () => {
    const { container } = render(<ScreenHeader title="Students" />);

    expect(titleRow(container).children).toHaveLength(1);
  });

  it("renders exactly one WovenRule — the screen's whole allowance", () => {
    const { container } = render(<ScreenHeader title="Students" description="A description." />);

    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
  });
});
