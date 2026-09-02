import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { AboutSchool } from "./about-school";

describe("AboutSchool", () => {
  it("renders the heading and splits body into paragraphs", () => {
    render(
      <AboutSchool
        section={makeSection({ body: "First paragraph.\n\nSecond paragraph." })}
        tenant={makeTenant()}
      />,
    );

    expect(screen.getByRole("heading", { name: "About our school" })).toBeInTheDocument();
    expect(screen.getByText("First paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph.")).toBeInTheDocument();
  });

  it("renders no image when image_url is absent", () => {
    render(<AboutSchool section={makeSection({ body: "Body." })} tenant={makeTenant()} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders nothing when body is missing", () => {
    const { container } = render(<AboutSchool section={makeSection({})} tenant={makeTenant()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
