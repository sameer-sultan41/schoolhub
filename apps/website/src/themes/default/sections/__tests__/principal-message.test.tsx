import { render, screen } from "@testing-library/react";
import { sectionProps } from "@/test-utils";
import { PrincipalMessage } from "../principal-message";

describe("PrincipalMessage", () => {
  it("renders the message and attribution", () => {
    render(
      <PrincipalMessage
        {...sectionProps({
          message: "Welcome to a new academic year.",
          principal_name: "Dr. Ayesha Khan",
          principal_title: "Principal",
        })}
      />,
    );

    expect(screen.getByText("Welcome to a new academic year.")).toBeInTheDocument();
    const name = screen.getByText("Dr. Ayesha Khan");
    expect(name.closest("figcaption")).toHaveTextContent("Dr. Ayesha Khan · Principal");
  });

  it("omits the attribution line when no principal name is given", () => {
    render(<PrincipalMessage {...sectionProps({ message: "Hello." })} />);
    expect(screen.queryByText(/Dr\. Ayesha Khan/)).not.toBeInTheDocument();
  });

  it("shows the name without a title when no principal_title is given", () => {
    render(
      <PrincipalMessage
        {...sectionProps({ message: "Hello.", principal_name: "Dr. Ayesha Khan" })}
      />,
    );
    const name = screen.getByText("Dr. Ayesha Khan");
    expect(name.closest("figcaption")).toHaveTextContent("Dr. Ayesha Khan");
    expect(name.closest("figcaption")).not.toHaveTextContent("·");
  });

  it("renders a photo when photo_url is given", () => {
    render(
      <PrincipalMessage
        {...sectionProps({
          message: "Hello.",
          principal_name: "Dr. Ayesha Khan",
          photo_url: "https://cdn.example.com/principal.jpg",
        })}
      />,
    );
    expect(screen.getByRole("img", { name: "Dr. Ayesha Khan" })).toBeInTheDocument();
  });

  it("renders nothing without a message", () => {
    const { container } = render(<PrincipalMessage {...sectionProps({})} />);
    expect(container).toBeEmptyDOMElement();
  });
});
