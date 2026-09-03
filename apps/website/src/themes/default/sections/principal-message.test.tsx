import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { PrincipalMessage } from "./principal-message";

describe("PrincipalMessage", () => {
  it("renders the message and attribution", () => {
    render(
      <PrincipalMessage
        section={makeSection({
          message: "Welcome to a new academic year.",
          principal_name: "Dr. Ayesha Khan",
          principal_title: "Principal",
        })}
        tenant={makeTenant()}
      />,
    );

    expect(screen.getByText("Welcome to a new academic year.")).toBeInTheDocument();
    const name = screen.getByText("Dr. Ayesha Khan");
    expect(name.closest("figcaption")).toHaveTextContent("Dr. Ayesha Khan · Principal");
  });

  it("omits the attribution line when no principal name is given", () => {
    render(<PrincipalMessage section={makeSection({ message: "Hello." })} tenant={makeTenant()} />);
    expect(screen.queryByText(/Dr\. Ayesha Khan/)).not.toBeInTheDocument();
  });

  it("shows the name without a title when no principal_title is given", () => {
    render(
      <PrincipalMessage
        section={makeSection({ message: "Hello.", principal_name: "Dr. Ayesha Khan" })}
        tenant={makeTenant()}
      />,
    );
    const name = screen.getByText("Dr. Ayesha Khan");
    expect(name.closest("figcaption")).toHaveTextContent("Dr. Ayesha Khan");
    expect(name.closest("figcaption")).not.toHaveTextContent("·");
  });

  it("renders a photo when photo_url is given", () => {
    render(
      <PrincipalMessage
        section={makeSection({
          message: "Hello.",
          principal_name: "Dr. Ayesha Khan",
          photo_url: "https://cdn.example.com/principal.jpg",
        })}
        tenant={makeTenant()}
      />,
    );
    expect(screen.getByRole("img", { name: "Dr. Ayesha Khan" })).toBeInTheDocument();
  });

  it("renders nothing without a message", () => {
    const { container } = render(
      <PrincipalMessage section={makeSection({})} tenant={makeTenant()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
