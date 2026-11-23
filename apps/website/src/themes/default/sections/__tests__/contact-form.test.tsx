import { render, screen } from "@testing-library/react";
import { makeContact, makeTenant, sectionProps } from "@/test-utils";
import { ContactForm } from "../contact-form";

jest.mock("@/components/public-enquiry-form", () => ({
  PublicEnquiryForm: ({
    kind,
    tenantSlug,
    sourcePageId,
  }: {
    kind: string;
    tenantSlug: string;
    sourcePageId?: string;
  }) => (
    <div data-testid="enquiry-form">
      {kind} / {tenantSlug} / {sourcePageId}
    </div>
  ),
}));

describe("ContactForm", () => {
  it("renders the tenant's published contact details", () => {
    const tenant = makeTenant({
      contact: makeContact({
        address: "12 School Road",
        phone: "+92-300-1234567",
        email: "info@cityschool.test",
      }),
    });
    render(<ContactForm {...sectionProps({}, tenant)} />);

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

  it("renders the enquiry form scoped to the tenant, the configured kind and the page", () => {
    render(
      <ContactForm
        {...sectionProps({ form: "admission_enquiry" }, makeTenant({ slug: "greenvalley" }))}
      />,
    );

    expect(screen.getByTestId("enquiry-form")).toHaveTextContent(
      "admission_enquiry / greenvalley / p1",
    );
  });

  it("omits contact details the API withholds", () => {
    render(<ContactForm {...sectionProps({}, makeTenant({ contact: null }))} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("omits blank contact fields", () => {
    render(<ContactForm {...sectionProps({}, makeTenant({ contact: makeContact() }))} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders an optional intro", () => {
    render(<ContactForm {...sectionProps({ intro: "We would love to hear from you." })} />);
    expect(screen.getByText("We would love to hear from you.")).toBeInTheDocument();
  });

  it("renders nothing when props fail validation", () => {
    const { container } = render(
      <ContactForm {...sectionProps({ form: "not_a_real_form_kind" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
