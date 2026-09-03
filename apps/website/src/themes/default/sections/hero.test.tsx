import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { Hero } from "./hero";

describe("Hero", () => {
  it("renders the heading, subheading and CTA", () => {
    render(
      <Hero
        section={makeSection({
          heading: "Welcome to City School",
          subheading: "Excellence since 1990",
          cta_label: "Apply now",
          cta_href: "/admissions",
        })}
        tenant={makeTenant()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome to City School" })).toBeInTheDocument();
    expect(screen.getByText("Excellence since 1990")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/admissions");
  });

  it("renders the background image when image_url is given", () => {
    render(
      <Hero
        section={makeSection({
          heading: "Welcome",
          image_url: "https://cdn.example.com/hero.jpg",
          image_alt: "Students in the courtyard",
        })}
        tenant={makeTenant()}
      />,
    );
    expect(screen.getByRole("img", { name: "Students in the courtyard" })).toBeInTheDocument();
  });

  it("omits the CTA when only one of label/href is given", () => {
    render(
      <Hero
        section={makeSection({ heading: "Welcome", cta_label: "Apply" })}
        tenant={makeTenant()}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing when required props fail validation", () => {
    const { container } = render(<Hero section={makeSection({})} tenant={makeTenant()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
