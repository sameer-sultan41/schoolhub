import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { ContactForm } from "./contact-form";

jest.mock("@/components/public-enquiry-form", () => ({
  PublicEnquiryForm: ({ kind, tenantSlug }: { kind: string; tenantSlug: string }) => (
    <div data-testid="enquiry-form">
      {kind} / {tenantSlug}
    </div>
  ),
}));

describe("ContactForm", () => {
  it("renders the tenant's published contact details", () => {
    render(
      <ContactForm
        section={makeSection({})}
        tenant={makeTenant({
          contact: {
            address: "12 School Road",
            phone: "+92-300-1234567",
            email: "info@cityschool.test",
          },
        })}
      />,
    );

    expect(screen.getByText("12 School Road")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+92-300-1234567" })).toHaveAttribute(
      "href",
      "tel:+92-300-1234567",
    );
    expect(screen.getByRole("link", { name: "info@cityschool.test" })).toHaveAttribute(
      "href",
      "mailto:info@cityschool.test",
    );
  });

  it("renders the enquiry form scoped to the tenant and configured kind", () => {
    render(
      <ContactForm
        section={makeSection({ form: "admission_enquiry" })}
        tenant={makeTenant({ slug: "greenvalley" })}
      />,
    );

    expect(screen.getByTestId("enquiry-form")).toHaveTextContent("admission_enquiry / greenvalley");
  });

  it("omits contact fields the tenant has not published", () => {
    render(<ContactForm section={makeSection({})} tenant={makeTenant({ contact: undefined })} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders an optional intro", () => {
    render(
      <ContactForm
        section={makeSection({ intro: "We would love to hear from you." })}
        tenant={makeTenant()}
      />,
    );
    expect(screen.getByText("We would love to hear from you.")).toBeInTheDocument();
  });

  it("renders nothing when props fail validation", () => {
    const { container } = render(
      <ContactForm section={makeSection({ form: "not_a_real_form_kind" })} tenant={makeTenant()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
