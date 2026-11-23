import { render, screen } from "@testing-library/react";
import { sectionProps } from "@/test-utils";
import { AdmissionsCta } from "../admissions-cta";

describe("AdmissionsCta", () => {
  it("renders defaults when no props are given", () => {
    render(<AdmissionsCta {...sectionProps({})} />);

    expect(screen.getByRole("heading", { name: "Admissions are open" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/admissions");
  });

  it("renders custom copy and link", () => {
    render(
      <AdmissionsCta
        {...sectionProps({
          heading: "Join us for 2027",
          body: "Limited seats remain.",
          cta_label: "Start application",
          cta_href: "/apply",
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Join us for 2027" })).toBeInTheDocument();
    expect(screen.getByText("Limited seats remain.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start application" })).toHaveAttribute(
      "href",
      "/apply",
    );
  });

  it("renders nothing when props fail validation", () => {
    const { container } = render(<AdmissionsCta {...sectionProps({ heading: 123 })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
