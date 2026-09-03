import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicEnquiryForm } from "./public-enquiry-form";

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ayesha Khan" } });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "ayesha@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Please send me the prospectus." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}

describe("PublicEnquiryForm", () => {
  it("posts to the contact endpoint with the tenant slug header", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(<PublicEnquiryForm kind="contact" tenantSlug="cityschool" />);

    fillAndSubmit();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/public/contact-messages");
    expect((init.headers as Record<string, string>)["X-Tenant-Slug"]).toBe("cityschool");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Ayesha Khan",
      email: "ayesha@example.com",
      message: "Please send me the prospectus.",
    });
  });

  it("posts to the admission-enquiry endpoint for that form kind", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(<PublicEnquiryForm kind="admission_enquiry" tenantSlug="cityschool" />);

    fillAndSubmit();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/api/v1/public/admission-enquiries");
  });

  it("shows a confirmation and hides the form on success", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(<PublicEnquiryForm kind="contact" tenantSlug="cityschool" />);

    fillAndSubmit();

    await waitFor(() => {
      expect(
        screen.getByText("Thank you — we have received your message and will be in touch."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
  });

  it("shows an error and keeps the form when the API rejects the submission", async () => {
    mockFetch.mockResolvedValue({ ok: false });
    render(<PublicEnquiryForm kind="contact" tenantSlug="cityschool" />);

    fillAndSubmit();

    await waitFor(() => {
      expect(
        screen.getByText("We could not send your message. Please try again in a moment."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("shows an error when the request itself throws", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    render(<PublicEnquiryForm kind="contact" tenantSlug="cityschool" />);

    fillAndSubmit();

    await waitFor(() => {
      expect(
        screen.getByText("We could not send your message. Please try again in a moment."),
      ).toBeInTheDocument();
    });
  });
});
