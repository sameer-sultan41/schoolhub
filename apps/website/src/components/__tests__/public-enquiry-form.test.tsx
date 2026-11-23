import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicEnquiryForm } from "../public-enquiry-form";

const mockFetch = jest.fn();
const API_ORIGIN = "https://api.schoolhub.test";

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
  it("posts the fields, the empty honeypot and the source page as a contact submission", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(
      <PublicEnquiryForm
        apiOrigin={API_ORIGIN}
        kind="contact"
        tenantSlug="cityschool"
        sourcePageId="p1"
      />,
    );

    fillAndSubmit();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_ORIGIN}/api/v1/public/contact-submissions`);
    expect((init.headers as Record<string, string>)["X-Tenant-Slug"]).toBe("cityschool");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Ayesha Khan",
      email: "ayesha@example.com",
      message: "Please send me the prospectus.",
      company_website: "",
      source_page_id: "p1",
    });
  });

  it("keeps the honeypot out of the tab order and away from assistive technology", () => {
    const { container } = render(
      <PublicEnquiryForm apiOrigin={API_ORIGIN} kind="contact" tenantSlug="cityschool" />,
    );
    const honeypot = container.querySelector('input[name="company_website"]');
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(honeypot).toHaveAttribute("autocomplete", "off");
    expect(honeypot).toHaveAttribute("data-1p-ignore");
    expect(honeypot).toHaveAttribute("data-lpignore", "true");
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText("Leave this field empty")).toBeInTheDocument();
  });

  it("posts an admission enquiry to the same endpoint with its fixed subject", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(
      <PublicEnquiryForm apiOrigin={API_ORIGIN} kind="admission_enquiry" tenantSlug="cityschool" />,
    );

    fillAndSubmit();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_ORIGIN}/api/v1/public/contact-submissions`);
    expect(JSON.parse(init.body as string)).toMatchObject({ subject: "Admission enquiry" });
    expect(JSON.parse(init.body as string)).not.toHaveProperty("source_page_id");
  });

  it("shows a confirmation and hides the form on success", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(<PublicEnquiryForm apiOrigin={API_ORIGIN} kind="contact" tenantSlug="cityschool" />);

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
    render(<PublicEnquiryForm apiOrigin={API_ORIGIN} kind="contact" tenantSlug="cityschool" />);

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
    render(<PublicEnquiryForm apiOrigin={API_ORIGIN} kind="contact" tenantSlug="cityschool" />);

    fillAndSubmit();

    await waitFor(() => {
      expect(
        screen.getByText("We could not send your message. Please try again in a moment."),
      ).toBeInTheDocument();
    });
  });

  function sentKeys(): string[] {
    return mockFetch.mock.calls.map(
      ([, init]) =>
        (init as RequestInit & { headers: Record<string, string> }).headers[
          "Idempotency-Key"
        ] as string,
    );
  }

  it("retries an unanswered submission under the same idempotency key", async () => {
    // No answer: the first request may have been stored, so the retry must replay it.
    mockFetch.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ ok: true });
    render(<PublicEnquiryForm apiOrigin={API_ORIGIN} kind="contact" tenantSlug="cityschool" />);

    fillAndSubmit();
    await screen.findByText("We could not send your message. Please try again in a moment.");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    const [first, second] = sentKeys();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it("starts a new key once the API has answered", async () => {
    // An edited retry under the answered key would be refused as a reused key.
    mockFetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    render(<PublicEnquiryForm apiOrigin={API_ORIGIN} kind="contact" tenantSlug="cityschool" />);

    fillAndSubmit();
    await screen.findByText("We could not send your message. Please try again in a moment.");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    const [first, second] = sentKeys();
    expect(second).not.toBe(first);
  });
});
